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
      errorMessage: '已停止生成。',
      solution: '可重新点击生成按钮继续。'
    };
  }
  if (error?.code === 'MISSING_MODEL_API_KEY') {
    return {
      errorType: 'model_not_configured',
      errorMessage: '未配置 DeepSeek API Key。',
      solution: '请在 PowerShell 中运行：$env:DEEPSEEK_API_KEY = "你的密钥"，然后重启服务。'
    };
  }
  if (error?.code === 'EMPTY_INPUT') {
    return {
      errorType: 'empty_input',
      errorMessage: '请输入客户信息、客户原话或希望 AI 帮助的问题。',
      solution: '在输入框中填写具体内容后重试。'
    };
  }

  if (error?.name === 'AbortError') {
    return {
      errorType: 'timeout',
      errorMessage: '模型响应超时（超过90秒）。',
      solution: '请稍后重试，或简化输入内容。如需调整超时时间，设置 MODEL_TIMEOUT_MS 环境变量后重启服务。'
    };
  }

  if (error?.code === 'INVALID_MODEL_RESPONSE') {
    return {
      errorType: 'invalid_response',
      errorMessage: '模型返回格式异常。',
      solution: '请确认 MODEL_BASE_URL 接口兼容 OpenAI Chat Completions 格式。'
    };
  }

  // HTTP 状态码错误
  const statusCode = error?.message?.match(/model service returned (\d+)/)?.[1];
  if (statusCode === '401') {
    return {
      errorType: 'auth_error',
      errorMessage: 'API 密钥无效或已过期。',
      solution: '请检查 DEEPSEEK_API_KEY 是否正确，或在 DeepSeek 控制台确认密钥状态。'
    };
  }
  if (statusCode === '429') {
    return {
      errorType: 'rate_limit',
      errorMessage: 'API 调用频率超限。',
      solution: '请等待 1 分钟后重试。'
    };
  }
  if (statusCode === '502' || statusCode === '503') {
    return {
      errorType: 'service_unavailable',
      errorMessage: `模型服务暂时不可用（HTTP ${statusCode}）。`,
      solution: 'DeepSeek 服务可能正在维护，请稍后重试。'
    };
  }

  const connectionCode = error?.cause?.code || error?.code;
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(connectionCode)) {
    return {
      errorType: 'unreachable',
      errorMessage: '模型服务不可达或网络不可达。',
      solution: '请检查 MODEL_BASE_URL 地址、端口和网络连接。'
    };
  }

  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    return {
      errorType: 'unreachable',
      errorMessage: '网络请求失败。',
      solution: '请检查网络连接和模型服务地址配置。'
    };
  }

  return {
    errorType: 'server_error',
    errorMessage: error?.message || '服务端异常，请稍后重试。',
    solution: '如问题持续出现，请检查后端日志或联系技术支持。'
  };
}
