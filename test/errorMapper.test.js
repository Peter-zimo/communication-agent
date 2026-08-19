import test from 'node:test';
import assert from 'node:assert/strict';

import { mapModelError } from '../src/modelClient.js';

test('mapModelError maps timeout aborts to timeout', () => {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';

  assert.deepEqual(mapModelError(error), {
    errorType: 'timeout',
    errorMessage: '模型响应超时（超过90秒）。',
    solution: '请稍后重试，或简化输入内容。如需调整超时时间，设置 MODEL_TIMEOUT_MS 环境变量后重启服务。'
  });
});

test('mapModelError maps connection failures to unreachable', () => {
  const error = new TypeError('fetch failed');
  error.cause = { code: 'ECONNREFUSED' };

  assert.deepEqual(mapModelError(error), {
    errorType: 'unreachable',
    errorMessage: '模型服务不可达或网络不可达。',
    solution: '请检查 MODEL_BASE_URL 地址、端口和网络连接。'
  });
});

test('mapModelError maps invalid model payloads to invalid_response', () => {
  const error = new Error('invalid model response');
  error.code = 'INVALID_MODEL_RESPONSE';

  assert.deepEqual(mapModelError(error), {
    errorType: 'invalid_response',
    errorMessage: '模型返回格式异常。',
    solution: '请确认 MODEL_BASE_URL 接口兼容 OpenAI Chat Completions 格式。'
  });
});
