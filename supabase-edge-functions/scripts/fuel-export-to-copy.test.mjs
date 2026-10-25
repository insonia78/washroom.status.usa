import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseValues, convertExport } from './fuel-export-to-copy.mjs';

test('SQL strings preserve apostrophes, delimiters, Unicode, backslashes and nulls', () => {
  assert.deepEqual(parseValues("'O''Brien, Québec', NULL, '', 'C:\\fuel', 42"), ["O'Brien, Québec", null, '', 'C:\\fuel', '42']);
  for (const value of ["'unfinished", 'now()', "'a',", "'a' 'b'"]) assert.throws(() => parseValues(value));
});

test('COPY maps sparse columns and escapes data while retaining schema and index', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fuel-copy-test-'));
  try {
    const source = join(directory, 'source.sql');
    const destination = join(directory, 'copy.sql');
    await writeFile(source, `BEGIN;
ALTER TABLE "public"."export_fuel" ADD COLUMN "name" VARCHAR;
ALTER TABLE "public"."export_fuel" ADD COLUMN "id" VARCHAR;
ALTER TABLE "public"."export_fuel" ADD COLUMN "check_date" date;
INSERT INTO "public"."export_fuel" ("id", "name", "wkb_geometry") VALUES ('node/1', 'O''Brien\\fuel\tQuébec', '0101');
INSERT INTO "public"."export_fuel" ("id", "name") VALUES ('node/2', 'Multi
line');
CREATE INDEX "export_fuel_wkb_geometry_geom_idx" ON "public"."export_fuel" USING GIST ("wkb_geometry");
COMMIT;
`);
    assert.equal(await convertExport(source, destination), 2);
    const result = await readFile(destination, 'utf8');
    assert.ok(result.includes('COPY public.export_fuel ("wkb_geometry","name","id","check_date") FROM stdin;\n'));
    assert.ok(result.includes("0101\tO'Brien\\\\fuel\\tQuébec\tnode/1\t\\N\n\\N\tMulti\\nline\tnode/2\t\\N\n\\.\nCREATE INDEX"));
    assert.ok(!result.includes('INSERT INTO'));
  } finally { await rm(directory, { recursive: true }); }
});
