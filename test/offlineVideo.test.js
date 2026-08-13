import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('static server serves MP4 with playable MIME type and range support', async () => {
  const server = await readFile('src/server.js', 'utf8');
  assert.match(server, /filePath\.endsWith\('\.mp4'\)\) return 'video\/mp4'/);
  assert.match(server, /request\.headers\.range/);
  assert.match(server, /Content-Range/);
  assert.match(server, /'Accept-Ranges': 'bytes'/);
});
