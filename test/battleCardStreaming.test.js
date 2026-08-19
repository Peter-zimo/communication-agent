import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { callModelStream, getModelConfig, mapModelError } from '../src/modelClient.js';

test('model stream supports an external cancellation signal', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });

  const controller = new AbortController();
  try {
    const request = callModelStream([{ role: 'user', content: 'test' }], () => {}, {
      apiKey: 'test-key',
      timeoutMs: 1000,
      signal: controller.signal
    });
    controller.abort();
    await assert.rejects(request, (error) => error.code === 'REQUEST_ABORTED');
    assert.deepEqual(mapModelError({ code: 'REQUEST_ABORTED' }), {
      errorType: 'cancelled',
      errorMessage: '已停止生成。',
      solution: '可重新点击生成按钮继续。'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('battle-card streaming contract uses a 45 second server timeout', async () => {
  const server = await readFile('src/server.js', 'utf8');
  const execution = await readFile('public/execution.js', 'utf8');
  const packageJson = await readFile('package.json', 'utf8');

  assert.equal(getModelConfig({ timeoutMs: 45000 }).timeoutMs, 45000);
  assert.match(server, /battle-card\/optimize-stream/);
  assert.match(server, /timeoutMs: 45000/);
  assert.match(server, /signal: controller\.signal/);
  assert.match(execution, /正在连接 DeepSeek/);
  assert.match(execution, /停止生成/);
  assert.match(execution, /重新生成/);
  assert.match(execution, /AI 候选方案/);
  assert.match(execution, /应用所选/);
  assert.match(execution, /撤销本次应用/);
  assert.match(execution, /battleCardRevision/);
  assert.match(server, /parseBattleCardProposal/);
  assert.match(server, /proposal: parseBattleCardProposal/);
  assert.match(execution, /本地服务仍在运行旧版本/);
  assert.match(packageJson, /"start": "node --watch src\/server\.js"/);
  assert.doesNotMatch(execution, /AI 优化失败，已保留 SOP 作战卡/);
});
