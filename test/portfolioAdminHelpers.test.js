import assert from 'node:assert/strict';
import test from 'node:test';

import {
  archiveRequest,
  beginMediaDeletion,
  confirmedMediaDeletion,
  prepareLocalMediaSelection,
  validateProjectDraft
} from '../public/portfolio-admin-helpers.js';

test('local media selection creates previews without upload and revokes replaced object URLs', () => {
  const events = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('local preview must not upload'); };
  const urlApi = {
    createObjectURL(file) {
      events.push(`create:${file.name}`);
      return `blob:${file.name}`;
    },
    revokeObjectURL(url) {
      events.push(`revoke:${url}`);
    }
  };
  const previous = [{ file: { name: 'old.jpg' }, url: 'blob:old.jpg', alt: '旧图' }];
  let result;
  try {
    result = prepareLocalMediaSelection(previous, [
      { name: 'cover.png', type: 'image/png', size: 20 * 1024 * 1024 },
      { name: 'movie.mp4', type: 'video/mp4', size: 500 * 1024 * 1024 },
      { name: 'bad.gif', type: 'image/gif', size: 100 },
      { name: 'huge.jpg', type: 'image/jpeg', size: 20 * 1024 * 1024 + 1 }
    ], urlApi);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(events, ['revoke:blob:old.jpg', 'create:cover.png', 'create:movie.mp4']);
  assert.deepEqual(result.items.map((item) => item.url), ['blob:cover.png', 'blob:movie.mp4']);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /JPEG.*PNG.*WebP.*MP4/);
  assert.match(result.errors[1], /20MB/);
});

test('draft validation rejects invalid size, empty alt text, and incomplete form data without mutation', () => {
  const validDraft = Object.freeze({
    id: 'local-demo', status: 'draft', title: '本机案例', summary: '摘要', role: '产品', year: '2026',
    value: '价值', challenge: '挑战', delivery: '交付', solutionSteps: ['第一步'],
    mediaAltText: [{ name: 'cover.jpg', alt: '封面图' }]
  });
  assert.equal(validateProjectDraft(validDraft), '');
  assert.match(validateProjectDraft({ ...validDraft, title: ' ' }), /文字字段/);
  assert.match(validateProjectDraft({ ...validDraft, solutionSteps: [] }), /1 到 6/);
  assert.match(validateProjectDraft({ ...validDraft, mediaAltText: [{ name: 'cover.jpg', alt: ' ' }] }), /替代文字/);
  assert.match(validateProjectDraft({ ...validDraft, id: 'Bad ID' }), /案例 ID/);
});

test('archive request carries archived status and media deletion requires a fresh explicit confirmation', () => {
  assert.deepEqual(archiveRequest('local-demo'), {
    url: '/api/portfolio/projects/local-demo/status',
    options: {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' })
    }
  });

  const dialog = { returnValue: 'cancel', opened: 0, showModal() { this.opened += 1; } };
  assert.equal(beginMediaDeletion(dialog, 'cover.jpg'), 'cover.jpg');
  assert.equal(dialog.returnValue, '');
  assert.equal(dialog.opened, 1);
  assert.equal(confirmedMediaDeletion(dialog, 'cover.jpg'), '');
  dialog.returnValue = 'cancel';
  assert.equal(confirmedMediaDeletion(dialog, 'cover.jpg'), '');
  dialog.returnValue = 'confirm';
  assert.equal(confirmedMediaDeletion(dialog, 'cover.jpg'), 'cover.jpg');
});
