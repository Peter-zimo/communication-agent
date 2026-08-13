import test from 'node:test';
import assert from 'node:assert/strict';

import { mapModelError } from '../src/modelClient.js';

test('mapModelError maps timeout aborts to timeout', () => {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';

  assert.deepEqual(mapModelError(error), {
    errorType: 'timeout',
    errorMessage: '模型超过等待时间未返回结果。请稍后重试，或将 MODEL_TIMEOUT_MS 调大后重启服务。'
  });
});

test('mapModelError maps connection failures to unreachable', () => {
  const error = new TypeError('fetch failed');
  error.cause = { code: 'ECONNREFUSED' };

  assert.deepEqual(mapModelError(error), {
    errorType: 'unreachable',
    errorMessage: '模型服务不可达或网络不可达。请检查模型地址、端口和内网连接。'
  });
});

test('mapModelError maps invalid model payloads to invalid_response', () => {
  const error = new Error('invalid model response');
  error.code = 'INVALID_MODEL_RESPONSE';

  assert.deepEqual(mapModelError(error), {
    errorType: 'invalid_response',
    errorMessage: '模型返回格式异常，请确认接口兼容 OpenAI Chat Completions 格式。'
  });
});
