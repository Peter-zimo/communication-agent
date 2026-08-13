import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start) : source.length;
  assert.notEqual(start, -1, `${name} must exist`);
  return source.slice(start, end);
}

test('portfolio exposes the approved semantic reading landmarks and placeholders', async () => {
  const html = await readFile(publicFile('portfolio.html'), 'utf8');

  assert.match(html, /<nav aria-label="作品集导航">/);
  assert.match(html, /AI 产品与售前解决方案作品集/);
  assert.match(html, /<main[\s>]/);
  assert.match(html, /id="featuredProjects"/);
  assert.match(html, /id="caseReader"[\s\S]*?<h2 id="caseReaderTitle">案例阅读<\/h2>/);
  assert.match(html, /\[ 姓名占位 \]/);
  assert.match(html, /\[ 联系方式占位：邮箱 \/ 微信 \/ 简历链接 \]/);
  assert.match(html, /业务理解.*AI 工作流设计.*原型与工程实现.*交付演示/s);
  assert.doesNotMatch(html, /<(?:link|script)\b[^>]+(?:href|src)=["']https?:\/\//i);
});

test('portfolio reader keeps article and heading levels nested under its section', async () => {
  const js = await readFile(publicFile('portfolio.js'), 'utf8');
  const reader = functionSource(js, 'openCaseReader');

  assert.match(reader, /const article = document\.createElement\('article'\)/);
  assert.match(reader, /textElement\('h3', project\.title, 'case-title'\)/);
  for (const heading of ['业务价值', '挑战', '解决方案', '交付说明']) {
    assert.match(reader, new RegExp(`textElement\\('h4', '${heading}'\\)`));
  }
  assert.match(js, /textElement\('h4', '演示视频'\)/);
  assert.match(js, /textElement\('h4', '关键体验'\)/);
});

test('published cards open the inline reader while coming-soon cards have no links', async () => {
  const js = await readFile(publicFile('portfolio.js'), 'utf8');
  const cards = functionSource(js, 'createProjectCard', 'renderProjectCards');

  assert.match(cards, /if \(project\.status === 'published'\)[\s\S]*?document\.createElement\('button'\)[\s\S]*?openCaseReader\(project\.id\)/);
  assert.match(cards, /else \{[\s\S]*?textElement\('p', '即将发布', 'coming-soon'\)/);
  assert.doesNotMatch(cards, /document\.createElement\('a'\)|\.href\s*=/);
});

test('reader orders the required case narrative', async () => {
  const js = await readFile(publicFile('portfolio.js'), 'utf8');
  const reader = functionSource(js, 'openCaseReader');
  const order = ['业务价值', 'createVideo', '挑战', '解决方案', 'createImageGallery', '交付说明', 'createNavigation'];
  const positions = order.map((item) => reader.indexOf(item));

  assert.ok(positions.every((position) => position !== -1));
  assert.ok(positions.every((position, index) => index === 0 || positions[index - 1] < position));
});

test('portfolio safely creates project text, defers video source assignment, and supports Escape close', async () => {
  const js = await readFile(publicFile('portfolio.js'), 'utf8');
  const video = functionSource(js, 'createVideo', 'openImageDialog');

  assert.match(js, /fetch\('\/api\/portfolio\/projects'\)/);
  assert.match(js, /element\.textContent = text/);
  assert.match(js, /textContent = project\.title/);
  for (const field of ['summary', 'value', 'challenge', 'delivery']) {
    assert.match(js, new RegExp(`textElement\\('p', project\\.${field}`));
  }
  assert.match(js, /textElement\('li', step\)/);
  assert.doesNotMatch(js, /\binnerHTML\s*(?:\+?=)/);
  assert.match(video, /video\.preload = 'none'/);
  assert.match(video, /video\.controls = true/);
  assert.match(video, /video\.autoplay = false/);
  assert.match(video, /startButton\.addEventListener\('click', async \(\) => \{[\s\S]*?video\.src = media/);
  assert.match(js, /imageDialog\.addEventListener\('keydown', \(event\) => \{\s*if \(event\.key === 'Escape'\) imageDialog\.close\(\);\s*\}\)/);
});

test('portfolio image actions identify the project and one-based image index', async () => {
  const js = await readFile(publicFile('portfolio.js'), 'utf8');
  const gallery = functionSource(js, 'createImageGallery', 'createNavigation');

  assert.match(gallery, /for \(const \[index, media\] of imageMedia\.entries\(\)\)/);
  assert.match(gallery, /button\.setAttribute\('aria-label', `查看\$\{project\.title\}案例图片 \$\{index \+ 1\}`\)/);
  assert.match(gallery, /openImageDialog\(media, project, index\)/);
  assert.match(js, /function openImageDialog\(media, project, index\)/);
  assert.match(js, /dialogImage\.alt = `\$\{project\.title\} 案例图片 \$\{index \+ 1\}`/);
});

test('portfolio style preserves the accessible minimal responsive system', async () => {
  const css = await readFile(publicFile('portfolio.css'), 'utf8');

  assert.match(css, /--paper:\s*#f4f0e8/i);
  assert.match(css, /--ink:\s*#161513/i);
  assert.match(css, /--accent:\s*#9b4b36/i);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*?\.project-grid, \.capability-list \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?transition:\s*none/);
  assert.doesNotMatch(css, /box-shadow\s*:/i);
});

test('local portfolio admin provides the required edit, preview, upload, and media-management contracts', async () => {
  const [portfolioHtml, adminHtml, adminJs, adminHelpers] = await Promise.all([
    readFile(publicFile('portfolio.html'), 'utf8'),
    readFile(publicFile('portfolio-admin.html'), 'utf8'),
    readFile(publicFile('portfolio-admin.js'), 'utf8'),
    readFile(publicFile('portfolio-admin-helpers.js'), 'utf8')
  ]);

  assert.doesNotMatch(portfolioHtml, /portfolio-admin\.html/);
  for (const id of ['projectForm', 'mediaInput', 'deleteMediaDialog']) {
    assert.match(adminHtml, new RegExp(`id="${id}"`));
  }
  assert.match(adminHtml, /accept="image\/jpeg,image\/png,image\/webp,video\/mp4"/);
  assert.match(adminJs, /new FormData\(\)/);
  assert.match(adminJs, /formData\.append\('project', JSON\.stringify\(project\)\)/);
  assert.match(adminJs, /formData\.append\('media', file, file\.name\)/);
  assert.match(adminJs, /fetch\('\/api\/portfolio\/projects\?include=all'\)/);
  assert.match(adminJs, /method: editingId \? 'PUT' : 'POST'/);
  assert.match(adminJs, /\/api\/portfolio\/projects\/\$\{editingId\}/);
  assert.match(adminHelpers, /\/status/);
  assert.match(adminJs, /response\.status === 409/);
  assert.doesNotMatch(adminJs, /\binnerHTML\s*(?:\+?=)/);
});

test('homepage and case reader expose poster-backed video actions and stored media descriptions', async () => {
  const js = await readFile(publicFile('portfolio.js'), 'utf8');
  const cards = functionSource(js, 'createProjectCard', 'renderProjectCards');
  const video = functionSource(js, 'createVideo', 'openImageDialog');
  const gallery = functionSource(js, 'createImageGallery', 'createNavigation');

  assert.match(cards, /project\.media\.find[\s\S]*?mediaKind\(medium\) === 'video'/);
  assert.match(cards, /video-entry[\s\S]*?openCaseReader\(project\.id/);
  assert.match(cards, /posterUrl/);
  assert.match(video, /video\.poster = media\.posterUrl/);
  assert.match(video, /media\.alt/);
  assert.match(video, /media\.caption/);
  assert.match(gallery, /media\.alt/);
  assert.match(gallery, /media\.caption/);
});

test('admin renders the complete managed media library and sends explicit deletion confirmation', async () => {
  const [adminHtml, adminJs] = await Promise.all([
    readFile(publicFile('portfolio-admin.html'), 'utf8'),
    readFile(publicFile('portfolio-admin.js'), 'utf8')
  ]);

  assert.match(adminHtml, /id="adminMediaLibrary"/);
  assert.match(adminJs, /fetch\('\/api\/portfolio\/media'\)/);
  assert.match(adminJs, /medium\.referenced/);
  assert.match(adminJs, /'X-Portfolio-Delete-Confirm': 'delete'/);
  assert.match(adminJs, /caption/);
});
