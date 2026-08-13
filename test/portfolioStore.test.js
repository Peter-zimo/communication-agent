import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deleteUnusedMedia,
  MEDIA_LIMITS,
  publishProject,
  readPortfolioProjects,
  replaceProject,
  setProjectStatus,
  validateMediaPart,
  validateProjectInput
} from '../src/portfolioStore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_DIR = path.join(ROOT, 'public', 'portfolio-media');
const PROJECTS_FILE = path.join(ROOT, 'content', 'portfolio', 'projects.json');

function safeDraft(id) {
  return {
    id,
    status: 'draft',
    title: '安全案例',
    summary: '用于验证存储行为。',
    role: '工程实现',
    year: '2026',
    value: '验证。',
    challenge: '验证。',
    solutionSteps: ['验证输入'],
    delivery: '本机。',
    media: []
  };
}

test('accepts a safe published project', () => {
  const result = validateProjectInput({
    id: 'presales-customer-communication-agent',
    status: 'published',
    title: '售前客户沟通智能体',
    summary: '让售前在客户交流前后都有结构化支持。',
    role: '产品设计与工程实现',
    year: '2026',
    value: '将准备、沟通与交付串为工作流。',
    challenge: '信息分散且依赖个人经验。',
    solutionSteps: ['会前作战卡', '会中动态清单'],
    delivery: '本机演示与可配置 SOP。',
    media: []
  });

  assert.equal(result.id, 'presales-customer-communication-agent');
});

test('rejects unsafe or oversized input', () => {
  assert.throws(() => validateProjectInput({ id: 'bad id', title: '<script>', media: [] }));
  assert.throws(() => validateMediaPart({ originalName: 'demo.exe', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1) }));
  assert.throws(() => validateMediaPart({ originalName: 'large.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(MEDIA_LIMITS.image + 1) }));
});

test('default portfolio reads include published and coming-soon projects only', async () => {
  const publicProjects = await readPortfolioProjects();

  assert.deepEqual(
    publicProjects.map((project) => project.id),
    [
      'presales-customer-communication-agent',
      'portfolio-coming-soon-one',
      'portfolio-coming-soon-two'
    ]
  );
  assert.deepEqual([...new Set(publicProjects.map((project) => project.status))].sort(), ['coming_soon', 'published']);
});

test('hides archived projects by default after a project status change', async () => {
  const projectId = 'portfolio-coming-soon-one';
  const originalProjects = await readFile(PROJECTS_FILE);
  await setProjectStatus(projectId, 'archived');
  try {
    const publicProjects = await readPortfolioProjects();
    const allProjects = await readPortfolioProjects({ includeUnpublished: true });

    assert.equal(publicProjects.some((project) => project.id === projectId), false);
    assert.equal(allProjects.find((project) => project.id === projectId)?.status, 'archived');
  } finally {
    await writeFile(PROJECTS_FILE, originalProjects);
  }
});

test('refuses to delete media referenced by a project in any status', async () => {
  await assert.rejects(
    () => deleteUnusedMedia('presales-agent-demo.mp4'),
    (error) => error.code === 'PORTFOLIO_MEDIA_REFERENCED'
  );
});

test('accepts only portfolio statuses when changing a project status', async () => {
  await assert.rejects(() => setProjectStatus('portfolio-coming-soon-one', 'private'), /状态/);
});

test('validates every upload before publish can create media files', async () => {
  const mediaBefore = await readdir(MEDIA_DIR);
  await assert.rejects(
    () => publishProject({
      project: safeDraft(`validation-${randomUUID()}`),
      mediaParts: [
        { originalName: 'safe.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('safe') },
        { originalName: 'unsafe.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('unsafe') }
      ]
    }),
    /媒体格式或大小/
  );
  assert.deepEqual(await readdir(MEDIA_DIR), mediaBefore);
});

test('serializes concurrent portfolio writes so neither project is lost', async () => {
  const originalProjects = await readFile(PROJECTS_FILE);
  const firstId = `concurrent-${randomUUID()}`;
  const secondId = `concurrent-${randomUUID()}`;

  try {
    await Promise.all([
      publishProject({ project: safeDraft(firstId), mediaParts: [] }),
      publishProject({ project: safeDraft(secondId), mediaParts: [] })
    ]);
    const ids = (await readPortfolioProjects({ includeUnpublished: true })).map((project) => project.id);
    assert.ok(ids.includes(firstId));
    assert.ok(ids.includes(secondId));
  } finally {
    await writeFile(PROJECTS_FILE, originalProjects);
  }
});

test('replaces an existing project while retaining submitted media references', async () => {
  const originalProjects = await readFile(PROJECTS_FILE);
  const project = (await readPortfolioProjects({ includeUnpublished: true })).find((item) => item.id === 'presales-customer-communication-agent');

  try {
    const updated = await replaceProject({
      project: { ...project, title: '已更新的售前客户沟通智能体', media: [...project.media] },
      mediaParts: []
    });

    assert.equal(updated.title, '已更新的售前客户沟通智能体');
    assert.deepEqual(updated.media, project.media);
  } finally {
    await writeFile(PROJECTS_FILE, originalProjects);
  }
});

test('removes a request-created media target when its file write fails', async () => {
  const mediaBefore = await readdir(MEDIA_DIR);
  await assert.rejects(() => publishProject({
    project: {
      ...safeDraft(`write-failure-${randomUUID()}`),
      mediaMetadata: [{ name: 'broken.jpg', alt: 'Broken image', caption: '' }]
    },
    mediaParts: [{ originalName: 'broken.jpg', mimeType: 'image/jpeg', buffer: { length: 1 } }]
  }));

  assert.deepEqual(await readdir(MEDIA_DIR), mediaBefore);
});

test('deletes an unreferenced media file only after two confirmations', async () => {
  const mediaId = `${randomUUID()}.jpg`;
  const mediaPath = path.join(MEDIA_DIR, mediaId);
  await writeFile(mediaPath, 'temporary media');

  await assert.rejects(() => deleteUnusedMedia(mediaId), /二次确认/);
  await access(mediaPath);
  await deleteUnusedMedia(mediaId, { firstConfirmation: true, secondConfirmation: true });
  await assert.rejects(() => access(mediaPath));
});

test('accepts legacy media URLs while retaining the complete managed media model', () => {
  const project = safeDraft(`media-model-${randomUUID()}`);
  const result = validateProjectInput({
    ...project,
    media: [
      '/presales-agent-demo.mp4',
      {
        id: 'managed-video',
        fileName: 'managed-video.mp4',
        url: '/portfolio-media/managed-video.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        alt: 'A safe video description',
        caption: 'A safe caption',
        posterUrl: '/portfolio-media/managed-poster.webp'
      }
    ]
  });

  assert.equal(result.media[0], '/presales-agent-demo.mp4');
  assert.deepEqual(result.media[1], {
    id: 'managed-video',
    fileName: 'managed-video.mp4',
    url: '/portfolio-media/managed-video.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    alt: 'A safe video description',
    caption: 'A safe caption',
    posterUrl: '/portfolio-media/managed-poster.webp'
  });
});

test('the seeded demonstration video has a local poster in its media model', async () => {
  const project = (await readPortfolioProjects({ includeUnpublished: true }))
    .find((item) => item.id === 'presales-customer-communication-agent');
  const video = project.media.find((medium) => typeof medium === 'object' && medium.kind === 'video');

  assert.equal(video.url, '/presales-agent-demo.mp4');
  assert.match(video.posterUrl, /^\/[a-z0-9][a-z0-9-]*\.(?:jpg|png|webp|svg)$/);
});

test('a managed image used as a retained video poster remains protected from deletion', async () => {
  const originalProjects = await readFile(PROJECTS_FILE);
  const mediaBefore = new Set(await readdir(MEDIA_DIR));
  const id = `poster-reference-${randomUUID()}`;
  try {
    const published = await publishProject({
      project: {
        ...safeDraft(id),
        mediaMetadata: [
          { name: 'poster.webp', alt: 'Video poster', caption: '' },
          { name: 'demo.mp4', alt: 'Demonstration video', caption: '' }
        ]
      },
      mediaParts: [
        { originalName: 'poster.webp', mimeType: 'image/webp', buffer: Buffer.from('poster') },
        { originalName: 'demo.mp4', mimeType: 'video/mp4', buffer: Buffer.from('video') }
      ]
    });
    const image = published.media.find((medium) => medium.kind === 'image');
    const video = published.media.find((medium) => medium.kind === 'video');
    await replaceProject({ project: { ...published, media: [video] }, mediaParts: [] });

    await assert.rejects(
      () => deleteUnusedMedia(image.fileName, { firstConfirmation: true, secondConfirmation: true }),
      (error) => error.code === 'PORTFOLIO_MEDIA_REFERENCED'
    );
    await access(path.join(MEDIA_DIR, image.fileName));
  } finally {
    await writeFile(PROJECTS_FILE, originalProjects);
    for (const fileName of await readdir(MEDIA_DIR)) {
      if (!mediaBefore.has(fileName)) await rm(path.join(MEDIA_DIR, fileName), { recursive: true, force: true });
    }
  }
});

test('an unsafe original filename cannot become persisted fallback alt text', async () => {
  const originalProjects = await readFile(PROJECTS_FILE);
  const mediaBefore = new Set(await readdir(MEDIA_DIR));
  try {
    await assert.rejects(() => publishProject({
      project: safeDraft(`unsafe-alt-${randomUUID()}`),
      mediaParts: [{ originalName: '<unsafe>.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('image') }]
    }), /媒体替代文字/);
  } finally {
    await writeFile(PROJECTS_FILE, originalProjects);
    for (const fileName of await readdir(MEDIA_DIR)) {
      if (!mediaBefore.has(fileName)) await rm(path.join(MEDIA_DIR, fileName), { recursive: true, force: true });
    }
  }
});
