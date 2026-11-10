import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('repository source files stay within 200 physical lines', async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8',
  }).split('\0').filter(file => /\.(?:[cm]?js|[cm]?ts|jsx|tsx|py|sql|css|scss|go|java|cs)$/.test(file));
  const violations = [];
  for (const file of new Set(files)) {
    let text;
    try { text = await readFile(resolve(root, file), 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (lines > 200) violations.push(`${file}: ${lines} lines`);
  }
  assert.deepEqual(violations, [], `Split oversized source files into cohesive modules:\n${violations.join('\n')}`);
});
