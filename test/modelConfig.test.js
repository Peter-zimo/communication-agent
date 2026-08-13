import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getModelConfig, mapModelError } from '../src/modelClient.js';

test('getModelConfig defaults model timeout to 90000ms', () => {
  const previous = process.env.MODEL_TIMEOUT_MS;
  const previousEndpoint = process.env.MODEL_BASE_URL;
  const previousModel = process.env.MODEL_NAME;
  const previousApiKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.MODEL_TIMEOUT_MS;
  delete process.env.MODEL_BASE_URL;
  delete process.env.MODEL_NAME;
  delete process.env.DEEPSEEK_API_KEY;

  try {
    assert.deepEqual(getModelConfig(), {
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-v4-flash',
      apiKey: '',
      timeoutMs: 90000
    });
  } finally {
    if (previous === undefined) {
      delete process.env.MODEL_TIMEOUT_MS;
    } else {
      process.env.MODEL_TIMEOUT_MS = previous;
    }
    if (previousEndpoint === undefined) delete process.env.MODEL_BASE_URL;
    else process.env.MODEL_BASE_URL = previousEndpoint;
    if (previousModel === undefined) delete process.env.MODEL_NAME;
    else process.env.MODEL_NAME = previousModel;
    if (previousApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousApiKey;
  }
});

test('mapModelError returns readable Chinese timeout and connection messages', () => {
  const timeout = new Error('The operation was aborted');
  timeout.name = 'AbortError';
  assert.deepEqual(mapModelError(timeout), {
    errorType: 'timeout',
    errorMessage: '模型超过等待时间未返回结果。请稍后重试，或将 MODEL_TIMEOUT_MS 调大后重启服务。'
  });

  const unreachable = new TypeError('fetch failed');
  unreachable.cause = { code: 'ECONNREFUSED' };
  assert.deepEqual(mapModelError(unreachable), {
    errorType: 'unreachable',
    errorMessage: '模型服务不可达或网络不可达。请检查模型地址、端口和内网连接。'
  });

  const missingKey = new Error('未配置 DeepSeek API Key。');
  missingKey.code = 'MISSING_MODEL_API_KEY';
  assert.deepEqual(mapModelError(missingKey), {
    errorType: 'model_not_configured',
    errorMessage: '未配置 DeepSeek API Key。请设置 DEEPSEEK_API_KEY 后重启服务。'
  });
});

test('server exposes model health diagnostics endpoint', async () => {
  const server = await readFile('src/server.js', 'utf8');

  assert.match(server, /model-health/);
  assert.match(server, /getModelConfig/);
  assert.match(server, /elapsedMs/);
  assert.match(server, /timeoutMs/);
});

test('server exposes SSE chat streaming endpoint', async () => {
  const server = await readFile('src/server.js', 'utf8');
  const modelClient = await readFile('src/modelClient.js', 'utf8');

  assert.match(server, /customer-communication.*chat-stream/);
  assert.match(server, /\/api\/scenes\/\$\{sceneId\}\/chat-stream/);
  assert.match(server, /\/api\/scenes\/\$\{sceneId\}\/config/);
  assert.match(server, /extractSceneRequest/);
  assert.match(server, /DEFAULT_SCENE_ID/);
  assert.match(server, /text\/event-stream; charset=utf-8/);
  assert.match(server, /sendSseEvent/);
  assert.match(server, /callModelStream/);
  assert.match(modelClient, /export async function callModelStream/);
  assert.match(modelClient, /stream: true/);
  assert.match(modelClient, /data: \[DONE\]/);
});
test('server caches content by sceneId for generic scene routes', async () => {
  const server = await readFile('src/server.js', 'utf8');

  assert.match(server, /contentPromises = new Map\(\)/);
  assert.match(server, /function getSceneContent\(sceneId\)/);
  assert.match(server, /loadContent\(sceneId\)/);
});
