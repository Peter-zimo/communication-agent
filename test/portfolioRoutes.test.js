import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

import { readPortfolioMultipart } from '../src/portfolioMultipart.js';

function multipartRequest(parts, boundary = 'portfolio-boundary') {
  const body = Buffer.concat([
    ...parts.flatMap((part) => [
      Buffer.from(`--${boundary}\r\n${part.headers}\r\n\r\n`),
      Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content),
      Buffer.from('\r\n')
    ]),
    Buffer.from(`--${boundary}--\r\n`)
  ]);
  const request = Readable.from([body]);
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  return request;
}

test('parses one project field and streams media file parts to temporary storage', async () => {
  const result = await readPortfolioMultipart(multipartRequest([
    {
      headers: 'Content-Disposition: form-data; name="project"',
      content: JSON.stringify({ id: 'portfolio-demo', status: 'draft' })
    },
    {
      headers: 'Content-Disposition: form-data; name="media"; filename="demo.jpg"\r\nContent-Type: image/jpeg',
      content: Buffer.from([0, 1, 2, 3])
    }
  ]), { maxBytes: 1024 });

  try {
    assert.deepEqual(result.project, { id: 'portfolio-demo', status: 'draft' });
    assert.equal(result.mediaParts[0].originalName, 'demo.jpg');
    assert.equal(result.mediaParts[0].mimeType, 'image/jpeg');
    assert.equal(result.mediaParts[0].size, 4);
    assert.deepEqual(await readFile(result.mediaParts[0].temporaryPath), Buffer.from([0, 1, 2, 3]));
  } finally {
    await Promise.all(result.mediaParts.map((part) => rm(part.temporaryPath, { force: true })));
  }
});

test('rejects a missing boundary and duplicate project fields', async () => {
  const missingBoundary = Readable.from([Buffer.from('body')]);
  missingBoundary.headers = { 'content-type': 'multipart/form-data' };
  await assert.rejects(() => readPortfolioMultipart(missingBoundary, { maxBytes: 1024 }), /boundary/i);

  await assert.rejects(() => readPortfolioMultipart(multipartRequest([
    { headers: 'Content-Disposition: form-data; name="project"', content: '{}' },
    { headers: 'Content-Disposition: form-data; name="project"', content: '{}' }
  ]), { maxBytes: 1024 }), /project/i);
});

test('rejects a wrong content type, malformed JSON, malformed file parts, and an oversized body without destroying the request', async () => {
  const wrongContentType = multipartRequest([
    { headers: 'Content-Disposition: form-data; name="project"', content: '{}' }
  ]);
  wrongContentType.headers['content-type'] = 'text/plain; boundary=portfolio-boundary';
  await assert.rejects(() => readPortfolioMultipart(wrongContentType, { maxBytes: 1024 }), /multipart\/form-data/i);

  await assert.rejects(() => readPortfolioMultipart(multipartRequest([
    { headers: 'Content-Disposition: form-data; name="project"', content: '{invalid json' }
  ]), { maxBytes: 1024 }), /valid JSON/i);

  await assert.rejects(() => readPortfolioMultipart(multipartRequest([
    { headers: 'Content-Disposition: form-data; name="project"', content: '{}' },
    { headers: 'Content-Disposition: form-data; name="media"; filename="missing-type.jpg"', content: 'file' }
  ]), { maxBytes: 1024 }), /filename and content type/i);

  const oversized = multipartRequest([
    { headers: 'Content-Disposition: form-data; name="project"', content: JSON.stringify({ payload: 'x'.repeat(2048) }) }
  ]);
  const originalDestroy = oversized.destroy.bind(oversized);
  let destroyed = false;
  oversized.destroy = (error) => {
    if (!oversized.readableEnded) destroyed = true;
    return originalDestroy(error);
  };
  await assert.rejects(() => readPortfolioMultipart(oversized, { maxBytes: 128 }), /exceeds/i);
  assert.equal(destroyed, false);
});

async function availablePort() {
  const listener = createNetServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function withServer(callback) {
  const port = await availablePort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('portfolio test server did not start')), 5000);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes(`http://localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`portfolio test server exited early with ${code}: ${stderr}`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  try {
    await ready;
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  }
}

test('portfolio routes return client errors without resetting the request', async () => {
  await withServer(async (origin) => {
    const malformedPatch = await fetch(`${origin}/api/portfolio/projects/presales-customer-communication-agent/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{'
    });
    assert.equal(malformedPatch.status, 400);
    assert.ok((await malformedPatch.json()).errorMessage);

    const unknownPut = await fetch(`${origin}/api/portfolio/projects/not-a-project`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not multipart'
    });
    assert.equal(unknownPut.status, 404);
    assert.ok((await unknownPut.json()).errorMessage);

    const referencedMedia = await fetch(`${origin}/api/portfolio/media/presales-agent-demo.mp4`, { method: 'DELETE' });
    assert.equal(referencedMedia.status, 409);

    const missingMedia = await fetch(`${origin}/api/portfolio/media/not-a-media.jpg`, { method: 'DELETE' });
    assert.equal(missingMedia.status, 404);
  });
});

test('portfolio route source contracts expose the planned endpoints and limits', async () => {
  const server = await readFile('src/server.js', 'utf8');
  assert.match(server, /\/api\/portfolio\/projects/);
  assert.match(server, /include=all/);
  assert.match(server, /readPortfolioMultipart/);
  assert.match(server, /\/api\/portfolio\/media\//);
  assert.match(server, /501 \* 1024 \* 1024/);
});

test('streams multipart media to a temporary file instead of retaining its buffer', async () => {
  const boundary = 'streaming-portfolio-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="project"\r\n\r\n${JSON.stringify({ id: 'streamed-demo', status: 'draft' })}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="demo.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
    Buffer.from('streamed-video-bytes'),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const request = Readable.from(Array.from({ length: Math.ceil(body.length / 7) }, (_, index) => body.subarray(index * 7, index * 7 + 7)));
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };

  const upload = await readPortfolioMultipart(request, { maxBytes: 1024 });
  try {
    assert.equal(upload.mediaParts[0].buffer, undefined);
    assert.equal(typeof upload.mediaParts[0].temporaryPath, 'string');
    assert.equal(upload.mediaParts[0].size, 20);
    assert.equal(await readFile(upload.mediaParts[0].temporaryPath, 'utf8'), 'streamed-video-bytes');
  } finally {
    await Promise.all(upload.mediaParts.map((part) => part.temporaryPath ? rm(part.temporaryPath, { force: true }) : undefined));
  }
});

test('discards multipart epilogue chunks after the closing boundary without retaining them', async () => {
  const boundary = 'epilogue-boundary';
  const request = Readable.from([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="project"\r\n\r\n${JSON.stringify({ id: 'epilogue-demo', status: 'draft' })}\r\n--${boundary}--\r\n`),
    Buffer.alloc(2 * 1024 * 1024, 1)
  ]);
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };

  const upload = await readPortfolioMultipart(request, { maxBytes: 3 * 1024 * 1024 });
  assert.deepEqual(upload, { project: { id: 'epilogue-demo', status: 'draft' }, mediaParts: [] });
});

test('publishing media returns a fetchable static URL and retains safe metadata', async () => {
  const originalProjects = await readFile('content/portfolio/projects.json');
  const mediaBefore = new Set(await readdir('public/portfolio-media'));
  let uploadedPath;
  try {
    await withServer(async (origin) => {
      const project = {
        id: `integration-${Date.now()}`,
        status: 'published',
        title: 'Integration project',
        summary: 'Published through the real HTTP boundary.',
        role: 'Product engineering',
        year: '2026',
        value: 'Proves the complete publish chain.',
        challenge: 'Media paths and metadata must remain aligned.',
        solutionSteps: ['Publish one media part'],
        delivery: 'Local static media.',
        media: [],
        mediaMetadata: [{ name: 'proof.png', alt: 'Integration proof image', caption: 'A safe retained caption.' }]
      };
      const form = new FormData();
      form.append('project', JSON.stringify(project));
      form.append('media', new Blob([Buffer.from('small-image-payload')], { type: 'image/png' }), 'proof.png');

      const response = await fetch(`${origin}/api/portfolio/projects`, { method: 'POST', body: form });
      assert.equal(response.status, 201);
      const payload = await response.json();
      const medium = payload.project.media[0];
      assert.match(medium.url, /^\/portfolio-media\/[a-f0-9-]+\.png$/);
      assert.equal(medium.fileName, medium.url.split('/').at(-1));
      assert.equal(medium.alt, 'Integration proof image');
      assert.equal(medium.caption, 'A safe retained caption.');
      uploadedPath = `public/${medium.url.slice(1)}`;

      const staticResponse = await fetch(`${origin}${medium.url}`);
      assert.equal(staticResponse.status, 200);
      assert.equal(Buffer.from(await staticResponse.arrayBuffer()).toString(), 'small-image-payload');
    });
  } finally {
    await writeFile('content/portfolio/projects.json', originalProjects);
    if (uploadedPath) await rm(uploadedPath, { force: true });
    for (const fileName of await readdir('public/portfolio-media')) {
      if (!mediaBefore.has(fileName)) await rm(`public/portfolio-media/${fileName}`, { recursive: true, force: true });
    }
  }
});

test('an orphaned managed upload remains visible in the media library and requires confirmation to delete', async () => {
  const mediaId = `orphan-${Date.now()}.jpg`;
  const mediaPath = `public/portfolio-media/${mediaId}`;
  await writeFile(mediaPath, 'orphan');
  try {
    await withServer(async (origin) => {
      const libraryResponse = await fetch(`${origin}/api/portfolio/media`);
      assert.equal(libraryResponse.status, 200);
      const library = await libraryResponse.json();
      assert.equal(library.media.find((medium) => medium.fileName === mediaId)?.referenced, false);

      const unconfirmed = await fetch(`${origin}/api/portfolio/media/${mediaId}`, { method: 'DELETE' });
      assert.equal(unconfirmed.status, 400);

      const confirmed = await fetch(`${origin}/api/portfolio/media/${mediaId}`, {
        method: 'DELETE',
        headers: { 'X-Portfolio-Delete-Confirm': 'delete' }
      });
      assert.equal(confirmed.status, 204);
    });
  } finally {
    await rm(mediaPath, { force: true });
  }
});

test('a PUT project ID mismatch cleans every streamed temporary media file', async () => {
  const temporaryDirectory = 'public/portfolio-media/.uploads';
  const before = new Set(await readdir(temporaryDirectory));
  await withServer(async (origin) => {
    const project = {
      id: 'different-project-id', status: 'draft', title: 'Mismatch', summary: 'Mismatch request.',
      role: 'Tester', year: '2026', value: 'Cleanup proof.', challenge: 'Reject mismatch.',
      solutionSteps: ['Submit mismatch'], delivery: 'No persisted media.', media: [],
      mediaMetadata: [{ name: 'mismatch.jpg', alt: 'Mismatch image', caption: '' }]
    };
    const form = new FormData();
    form.append('project', JSON.stringify(project));
    form.append('media', new Blob([Buffer.from('mismatch')], { type: 'image/jpeg' }), 'mismatch.jpg');
    const response = await fetch(`${origin}/api/portfolio/projects/presales-customer-communication-agent`, {
      method: 'PUT', body: form
    });
    assert.equal(response.status, 400);
  });
  assert.deepEqual(new Set(await readdir(temporaryDirectory)), before);
});

test('server binds to loopback, rejects non-loopback write peers, and streams static ranges', async () => {
  const { isLoopbackAddress, isPortfolioWriteRequest } = await import('../src/portfolioNetwork.js');
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.20'), false);
  assert.equal(isPortfolioWriteRequest('POST', '/api/portfolio/projects'), true);
  assert.equal(isPortfolioWriteRequest('GET', '/api/portfolio/projects'), false);

  const source = await readFile('src/server.js', 'utf8');
  assert.match(source, /server\.listen\(PORT, '127\.0\.0\.1'/);
  const staticSource = source.slice(source.indexOf('async function serveStatic'), source.indexOf('function readJsonBody'));
  assert.match(staticSource, /createReadStream/);
  assert.match(staticSource, /await stat\(filePath\)/);
  assert.doesNotMatch(staticSource, /await readFile\(filePath\)/);

  await withServer(async (origin) => {
    const poster = await fetch(`${origin}/portfolio-video-poster.svg`);
    assert.equal(poster.status, 200);
    assert.equal(poster.headers.get('content-type'), 'image/svg+xml');

    const response = await fetch(`${origin}/presales-agent-demo.mp4`, { headers: { Range: 'bytes=0-15' } });
    assert.equal(response.status, 206);
    assert.equal((await response.arrayBuffer()).byteLength, 16);
  });
});
