import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachmentRequestPayload,
  createAttachmentState,
  normalizeAttachmentText,
  resolveAttachmentSnapshotForSend
} from '../public/attachmentHelpers.js';

test('normalizes markdown attachment text before sending', () => {
  assert.equal(normalizeAttachmentText('第一行\r\n\r\n\r\n第二行  '), '第一行\n\n第二行');
});

test('creates a ready markdown attachment state with text', async () => {
  const file = {
    name: 'meeting.md',
    size: 48,
    text: async () => '附件正文：客户关注已有系统集成边界'
  };

  const attachmentState = await createAttachmentState(file);

  assert.equal(attachmentState.status, 'ready');
  assert.equal(attachmentState.fileName, 'meeting.md');
  assert.equal(attachmentState.fileType, 'md');
  assert.match(attachmentState.text, /已有系统集成边界/);
});

test('does not create a send snapshot while attachment is still reading', async () => {
  const attachmentState = { status: 'reading', promise: Promise.resolve({ status: 'ready', text: '正文' }) };

  await assert.rejects(
    () => resolveAttachmentSnapshotForSend(attachmentState),
    /文档仍在读取中/
  );
});

test('builds chat request attachments from a ready markdown snapshot', async () => {
  const attachmentState = {
    status: 'ready',
    fileName: 'meeting.md',
    fileType: 'md',
    text: '附件正文：客户关注已有系统集成边界'
  };

  const snapshot = await resolveAttachmentSnapshotForSend(attachmentState);
  const payload = attachmentRequestPayload(snapshot);

  assert.deepEqual(payload, [{
    fileName: 'meeting.md',
    fileType: 'md',
    text: '附件正文：客户关注已有系统集成边界'
  }]);
});

test('rejects empty attachment text before sending', async () => {
  const attachmentState = { status: 'ready', fileName: 'empty.md', fileType: 'md', text: '   ' };

  await assert.rejects(
    () => resolveAttachmentSnapshotForSend(attachmentState),
    /文档内容为空/
  );
});
