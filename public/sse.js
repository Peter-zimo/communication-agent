export async function readSseStream(response, onEvent) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('流式响应不可用。');

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    events.forEach((eventText) => {
      const parsed = parseSseEvent(eventText);
      if (parsed) onEvent(parsed.event, parsed.payload);
    });
  }
}

export function parseSseEvent(eventText) {
  const event = eventText.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
  const data = eventText.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
  if (!event || !data) return null;
  return { event, payload: JSON.parse(data) };
}
