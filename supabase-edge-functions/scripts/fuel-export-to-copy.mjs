import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export function parseValues(text) {
  const values = [];
  let position = 0;
  while (position < text.length) {
    while (/\s/.test(text[position] || '') && position < text.length) position++;
    if (text[position] === "'") {
      position++;
      let value = '';
      let closed = false;
      while (position < text.length) {
        if (text[position] === "'") {
          if (text[position + 1] === "'") { value += "'"; position += 2; }
          else { position++; closed = true; break; }
        } else value += text[position++];
      }
      if (!closed) throw new Error('Unterminated SQL string');
      values.push(value);
    } else {
      const match = /^(NULL|[-+]?\d+(?:\.\d+)?)(?=\s*(?:,|$))/.exec(text.slice(position));
      if (!match) throw new Error(`Unsupported SQL value at offset ${position}`);
      values.push(match[1] === 'NULL' ? null : match[1]);
      position += match[0].length;
    }
    while (position < text.length && /\s/.test(text[position])) position++;
    if (position === text.length) break;
    if (text[position++] !== ',' || !text.slice(position).trim()) throw new Error('Invalid value separator');
  }
  return values;
}

function copyValue(value) {
  return value === null ? '\\N' : value.replaceAll('\\', '\\\\')
    .replaceAll('\t', '\\t').replaceAll('\n', '\\n').replaceAll('\r', '\\r');
}

async function* exportStatements(lines) {
  let pending = '';
  for await (const line of lines) {
    if (pending || line.startsWith('INSERT INTO')) {
      pending += (pending ? '\n' : '') + line;
      if (!pending.endsWith(');')) continue;
      yield pending;
      pending = '';
    } else yield line;
  }
  if (pending) throw new Error('Unterminated INSERT statement');
}

export async function convertExport(source, destination) {
  const columns = ['wkb_geometry'];
  const output = createWriteStream(destination, { encoding: 'utf8' });
  let outputError;
  output.on('error', error => { outputError = error; });
  const write = async text => {
    if (outputError) throw outputError;
    if (!output.write(text)) await once(output, 'drain');
  };
  let rows = 0;
  let copying = false;
  let finished = false;
  let index = false;
  const lines = createInterface({ input: createReadStream(source, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of exportStatements(lines)) {
      const column = /^ALTER TABLE "public"\."export_fuel" ADD COLUMN "((?:[^"]|"")+)" (?!SERIAL\b).+;$/.exec(line);
      if (column) columns.push(column[1].replaceAll('""', '"'));
      if (line.startsWith('INSERT INTO')) {
        if (finished) throw new Error('INSERT after COPY section');
        const match = /^INSERT INTO "public"\."export_fuel" \((.+)\) VALUES \(([\s\S]*)\);$/.exec(line);
        if (!match) throw new Error(`Unsupported INSERT at row ${rows + 1}`);
        const names = match[1].split(/,\s*/).map(name => {
          if (!/^"(?:[^"]|"")+"$/.test(name)) throw new Error('Invalid column identifier');
          return name.slice(1, -1).replaceAll('""', '"');
        });
        const values = parseValues(match[2]);
        if (names.length !== values.length || new Set(names).size !== names.length ||
            names.some(name => !columns.includes(name))) throw new Error(`Invalid INSERT columns at row ${rows + 1}: ${names.length} columns, ${values.length} values; unknown columns: ${names.filter(name => !columns.includes(name)).join(', ')}`);
        if (!copying) {
          if (new Set(columns).size !== columns.length) throw new Error('Duplicate schema columns');
          await write(`COPY public.export_fuel (${columns.map(name => `"${name.replaceAll('"', '""')}"`).join(',')}) FROM stdin;\n`);
          copying = true;
        }
        const row = new Map(names.map((name, i) => [name, values[i]]));
        await write(columns.map(name => copyValue(row.get(name) ?? null)).join('\t') + '\n');
        rows++;
      } else {
        if (copying) { await write('\\.\n'); copying = false; finished = true; }
        if (line.startsWith('CREATE INDEX "export_fuel_wkb_geometry_geom_idx"')) index = true;
        await write(line + '\n');
      }
    }
    if (copying || !rows || !index) throw new Error('Incomplete export: missing rows, index or COPY terminator');
    output.end();
    await once(output, 'finish');
    return rows;
  } catch (error) {
    output.destroy();
    throw error;
  } finally {
    lines.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node fuel-export-to-copy.mjs source.sql destination.sql');
    console.log(`Converted ${await convertExport(process.argv[2], process.argv[3])} fuel locations to COPY.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
