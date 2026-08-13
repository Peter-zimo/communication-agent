const DEFAULT_MODEL_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 90000;

export function getModelConfig(options = {}) {
  return {
    endpoint: options.endpoint || process.env.MODEL_BASE_URL || DEFAULT_MODEL_URL,
    model: options.model || process.env.MODEL_NAME || DEFAULT_MODEL,
    apiKey: options.apiKey || process.env.DEEPSEEK_API_KEY || '',
    timeoutMs: Number(options.timeoutMs || process.env.MODEL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

export async function callModel(messages, options = {}) {
  const { endpoint, model, apiKey, timeoutMs } = getModelConfig(options);
  assertApiKey(apiKey);
  const request = createAbortableRequest(timeoutMs, options.signal);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders(apiKey),
      body: JSON.stringify({ model, messages, temperature: 0.4 }),
      signal: request.signal
    });

    if (!response.ok) {
      const error = new Error(`model service returned ${response.status}`);
      error.code = response.status >= 500 ? 'MODEL_SERVER_ERROR' : 'MODEL_BAD_REQUEST';
      throw error;
    }

    const payload = await response.json();
    const answer = payload?.choices?.[0]?.message?.content;
    if (!answer || typeof answer !== 'string') {
      const error = new Error('invalid model response');
      error.code = 'INVALID_MODEL_RESPONSE';
      throw error;
    }

    return answer.trim();
  } catch (error) {
    throw normalizeAbortError(error, request);
  } finally {
    request.cleanup();
  }
}

export async function callModelStream(messages, onDelta, options = {}) {
  const { endpoint, model, apiKey, timeoutMs } = getModelConfig(options);
  assertApiKey(apiKey);
  const request = createAbortableRequest(timeoutMs, options.signal);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders(apiKey),
      body: JSON.stringify({ model, messages, temperature: 0.4, stream: true }),
      signal: request.signal
    });

    if (!response.ok) {
      const error = new Error(`model service returned ${response.status}`);
      error.code = response.status >= 500 ? 'MODEL_SERVER_ERROR' : 'MODEL_BAD_REQUEST';
      throw error;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const error = new Error('invalid model response');
      error.code = 'INVALID_MODEL_RESPONSE';
      throw error;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        // OpenAI-compatible streams end with the raw SSE line: data: [DONE]
        if (data === '[DONE]') return;

        const payload = JSON.parse(data);
        const delta = payload?.choices?.[0]?.delta?.content || payload?.choices?.[0]?.message?.content || '';
        if (delta) onDelta(delta);
      }
    }
  } catch (error) {
    throw normalizeAbortError(error, request);
  } finally {
    request.cleanup();
  }
}

function createAbortableRequest(timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  const abortForTimeout = () => {
    timedOut = true;
    controller.abort();
  };
  const abortForExternalSignal = () => {
    externallyAborted = true;
    controller.abort();
  };
  const timeout = setTimeout(abortForTimeout, timeoutMs);
  externalSignal?.addEventListener('abort', abortForExternalSignal, { once: true });
  if (externalSignal?.aborted) abortForExternalSignal();

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortForExternalSignal);
    },
    timedOut: () => timedOut,
    externallyAborted: () => externallyAborted
  };
}

function normalizeAbortError(error, request) {
  if (request.externallyAborted()) {
    const aborted = new Error('model request cancelled');
    aborted.code = 'REQUEST_ABORTED';
    return aborted;
  }
  if (request.timedOut()) {
    const timedOut = new Error('model request timed out');
    timedOut.name = 'AbortError';
    return timedOut;
  }
  return error;
}

function assertApiKey(apiKey) {
  if (apiKey) return;
  const error = new Error('未配置 DeepSeek API Key。');
  error.code = 'MISSING_MODEL_API_KEY';
  throw error;
}

function requestHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
}

export function mapModelError(error) {
  if (error?.code === 'REQUEST_ABORTED') {
    return {
      errorType: 'cancelled',
      errorMessage: '已停止生成。'
    };
  }
  if (error?.code === 'MISSING_MODEL_API_KEY') {
    return {
      errorType: 'model_not_configured',
      errorMessage: '未配置 DeepSeek API Key。请设置 DEEPSEEK_API_KEY 后重启服务。'
    };
  }
  if (error?.code === 'EMPTY_INPUT') {
    return {
      errorType: 'empty_input',
      errorMessage: '请输入客户信息、客户原话或希望 AI 帮助的问题。'
    };
  }

  if (error?.name === 'AbortError') {
    return {
      errorType: 'timeout',
      errorMessage: '模型超过等待时间未返回结果。请稍后重试，或将 MODEL_TIMEOUT_MS 调大后重启服务。'
    };
  }

  if (error?.code === 'INVALID_MODEL_RESPONSE') {
    return {
      errorType: 'invalid_response',
      errorMessage: '模型返回格式异常，请确认接口兼容 OpenAI Chat Completions 格式。'
    };
  }

  const connectionCode = error?.cause?.code || error?.code;
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(connectionCode)) {
    return {
      errorType: 'unreachable',
      errorMessage: '模型服务不可达或网络不可达。请检查模型地址、端口和内网连接。'
    };
  }

  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    return {
      errorType: 'unreachable',
      errorMessage: '模型服务不可达或网络不可达。请检查模型地址、端口和内网连接。'
    };
  }

  return {
    errorType: 'server_error',
    errorMessage: '服务端异常，请稍后重试。'
  };
}
