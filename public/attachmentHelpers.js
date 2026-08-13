export const EMPTY_ATTACHMENT_STATE = Object.freeze({ status: 'idle' });

const SUPPORTED_EXTENSIONS = new Set(['md', 'markdown', 'docx']);
const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_LENGTH = 12000;

export function normalizeAttachmentText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_ATTACHMENT_TEXT_LENGTH);
}

export async function createAttachmentState(file, options = {}) {
  const fileName = file?.name || '未命名文档';
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error('仅支持上传 md、markdown 或 docx 文档。');
  if (Number(file?.size || 0) > MAX_ATTACHMENT_SIZE) throw new Error('单个文档不能超过 2MB。');

  if (extension === 'md' || extension === 'markdown') {
    const text = normalizeAttachmentText(await file.text());
    if (!text) throw new Error('文档内容为空，请重新选择。');
    return { status: 'ready', fileName, fileType: extension, text };
  }

  if (typeof options.parseDocx !== 'function') throw new Error('Word 文档解析能力不可用，请重新选择 Markdown 文档。');
  const text = normalizeAttachmentText(await options.parseDocx(file));
  if (!text) throw new Error('Word 文档未解析出文本内容。');
  return { status: 'ready', fileName, fileType: 'docx', text };
}

export async function resolveAttachmentSnapshotForSend(attachmentState) {
  if (!attachmentState || attachmentState.status === 'idle') return null;
  if (attachmentState.status === 'reading') throw new Error('文档仍在读取中，请稍候再生成。');
  if (attachmentState.status === 'error') throw new Error(attachmentState.errorMessage || '文档读取失败，请重新选择。');
  if (attachmentState.status !== 'ready') return null;

  const text = normalizeAttachmentText(attachmentState.text);
  if (!text) throw new Error('文档内容为空，请重新选择。');
  return {
    fileName: attachmentState.fileName || '未命名文档',
    fileType: attachmentState.fileType || 'document',
    text
  };
}

export function attachmentRequestPayload(snapshot) {
  return snapshot ? [snapshot] : [];
}
