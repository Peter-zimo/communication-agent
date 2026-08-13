# 个人作品集网站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在现有本机 Node 服务中交付高级极简的多项目作品集，以及可安全发布图片和视频的本机内容管理页。

**Architecture:** 前台从 content/portfolio/projects.json 读取案例，媒体由现有静态服务从 public/portfolio-media/ 提供。管理页先用浏览器 Object URL 做预览；用户点击发布后，以 multipart 案例接口校验并写入媒体和 JSON。领域校验、文件命名、引用检查集中在 src/portfolioStore.js，HTTP 路由只处理协议。

**Tech Stack:** Node.js ESM、原生 node:http 和 node:fs/promises、浏览器原生 HTML/CSS/JavaScript、Node test runner；不新增 npm 依赖。

## Global Constraints

- 不改动既有售前智能体、DeepSeek、会议流程、DOCX 或作战卡流式功能。
- 仅本机演示；不加登录、云存储、公开实时 AI、第三方视频或分析脚本。
- 不使用真实姓名、联系方式或模型密钥；身份和联系信息均为可替换占位内容。
- 仅 JPG、PNG、WebP、MP4；图片最大 20MB，视频最大 500MB。
- 点击发布前，文件只可在浏览器临时预览，不能写磁盘。
- 删除媒体需二次确认，且有任何案例引用时拒绝删除。
- 案例文字以 DOM textContent 渲染，禁止未转义数据进入 innerHTML。
- 支持键盘与减少动态效果偏好；视频不自动播放或预加载。

---

## File Structure

| 路径 | 职责 |
| --- | --- |
| src/portfolioStore.js | schema、字段/媒体校验、文件名生成、JSON 原子读写、引用检查。 |
| src/portfolioMultipart.js | 仅解析 multipart 的 project 字段与 media 文件部件。 |
| src/server.js | 追加作品集 API，不改变既有路由及 MP4 Range。 |
| content/portfolio/projects.json | 智能体案例与两个即将发布案例。 |
| public/portfolio.html、public/portfolio.js | 公开首页、案例阅读器和安全媒体展示。 |
| public/portfolio-admin.html、public/portfolio-admin.js | 隐藏的本机管理页、预览与发布。 |
| public/portfolio.css | 高级极简响应式设计系统。 |
| public/portfolio-media/.gitkeep | 上传目录占位。 |
| test/portfolioStore.test.js | 存储单元测试。 |
| test/portfolioRoutes.test.js | 路由和上传限制契约。 |
| test/portfolioUiContract.test.js | 前端结构、安全渲染、媒体和无障碍契约。 |

## Interfaces

~~~js
export const MEDIA_LIMITS = { image: 20 * 1024 * 1024, video: 500 * 1024 * 1024 };
export async function readPortfolioProjects({ includeUnpublished = false } = {});
export function validateProjectInput(input);
export function validateMediaPart(part);
export async function publishProject({ project, mediaParts });
export async function setProjectStatus(projectId, status);
export async function deleteUnusedMedia(mediaId);
export async function readPortfolioMultipart(request, { maxBytes });
~~~

~~~text
GET    /api/portfolio/projects                    -> published 和 coming_soon
GET    /api/portfolio/projects?include=all        -> 全部状态
POST   /api/portfolio/projects                    -> multipart, 201
PUT    /api/portfolio/projects/:projectId         -> multipart, 200
PATCH  /api/portfolio/projects/:projectId/status  -> JSON status, 200
DELETE /api/portfolio/media/:mediaId              -> 204；引用中返回 409
~~~

### Task 1: 建立案例与媒体存储边界

**Files:** Create src/portfolioStore.js, content/portfolio/projects.json, public/portfolio-media/.gitkeep; Test test/portfolioStore.test.js.  
**Consumes:** Node fs/promises、path。  
**Produces:** 所有存储接口，供 Task 2 调用。

- [ ] **Step 1: Write the failing tests**

~~~js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMediaPart, validateProjectInput, MEDIA_LIMITS } from '../src/portfolioStore.js';

test('accepts a safe published project', () => {
  const result = validateProjectInput({
    id: 'presales-customer-communication-agent', status: 'published',
    title: '售前客户沟通智能体', summary: '让售前在客户交流前后都有结构化支持。',
    role: '产品设计与工程实现', year: '2026', value: '将准备、沟通与交付串为工作流。',
    challenge: '信息分散且依赖个人经验。', solutionSteps: ['会前作战卡', '会中动态清单'],
    delivery: '本机演示与可配置 SOP。', media: []
  });
  assert.equal(result.id, 'presales-customer-communication-agent');
});
test('rejects unsafe or oversized input', () => {
  assert.throws(() => validateProjectInput({ id: 'bad id', title: '<script>', media: [] }));
  assert.throws(() => validateMediaPart({ originalName: 'demo.exe', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1) }));
  assert.throws(() => validateMediaPart({ originalName: 'large.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(MEDIA_LIMITS.image + 1) }));
});
~~~

- [ ] **Step 2: Run:** node --test test/portfolioStore.test.js  
Expected: FAIL because src/portfolioStore.js does not exist.

- [ ] **Step 3: Implement minimal store**

~~~js
const ALLOWED_MEDIA = new Map([
  ['image/jpeg', { extension: '.jpg', limit: MEDIA_LIMITS.image, kind: 'image' }],
  ['image/png', { extension: '.png', limit: MEDIA_LIMITS.image, kind: 'image' }],
  ['image/webp', { extension: '.webp', limit: MEDIA_LIMITS.image, kind: 'image' }],
  ['video/mp4', { extension: '.mp4', limit: MEDIA_LIMITS.video, kind: 'video' }]
]);
export function validateMediaPart(part) {
  const rule = ALLOWED_MEDIA.get(part.mimeType);
  if (!rule || part.buffer.length > rule.limit) throw new Error('媒体格式或大小不符合要求。');
  return { ...rule, originalName: path.basename(part.originalName) };
}
~~~

Require id matching /^[a-z0-9]+(?:-[a-z0-9]+)*$/, status published/draft/coming_soon/archived, bounded text fields and 1-6 solution steps. Seed the approved smart-agent case referencing /presales-agent-demo.mp4 and two coming_soon cards. Generate upload filenames server-side. Write JSON to a sibling temporary file and rename it only after validation; if a media write later fails, remove only files newly created by that request.

- [ ] **Step 4: Add status/reference tests and implement them**

~~~js
test('hides drafts publicly but keeps archived projects in management', async () => {
  const publicProjects = await readPortfolioProjects();
  const allProjects = await readPortfolioProjects({ includeUnpublished: true });
  assert.ok(publicProjects.every((p) => p.status === 'published' || p.status === 'coming_soon'));
  assert.ok(allProjects.some((p) => p.status === 'archived'));
});
test('refuses removal of referenced media', async () => {
  await assert.rejects(() => deleteUnusedMedia('referenced-demo'), /仍被案例引用/);
});
~~~

deleteUnusedMedia scans every project status. setProjectStatus only accepts the four listed statuses.

- [ ] **Step 5: Run:** node --test test/portfolioStore.test.js  
Expected: PASS.

- [ ] **Step 6: Commit if Git is available**

~~~bash
git add src/portfolioStore.js content/portfolio/projects.json public/portfolio-media/.gitkeep test/portfolioStore.test.js
git commit -m "feat: add local portfolio store"
~~~

This workspace is not a Git repository. Do not initialize one; record the skipped commit.

### Task 2: 添加受限 multipart 解析与 API

**Files:** Create src/portfolioMultipart.js; modify src/server.js; test test/portfolioRoutes.test.js.  
**Consumes:** Task 1 interfaces and existing sendJson/static conventions.  
**Produces:** All six routes above.

- [ ] **Step 1: Write failing route contracts**

~~~js
test('portfolio routes separate public reads from local writes', async () => {
  const server = await readFile('src/server.js', 'utf8');
  assert.match(server, /\/api\/portfolio\/projects/);
  assert.match(server, /include=all/);
  assert.match(server, /readPortfolioMultipart/);
  assert.match(server, /\/api\/portfolio\/media\//);
});
test('portfolio upload has the stated ceiling', async () => {
  const server = await readFile('src/server.js', 'utf8');
  assert.match(server, /501 \* 1024 \* 1024/);
});
~~~

- [ ] **Step 2: Run:** node --test test/portfolioRoutes.test.js  
Expected: FAIL because routes are missing.

- [ ] **Step 3: Implement bounded multipart parsing**

~~~js
export async function readPortfolioMultipart(request, { maxBytes }) {
  const body = await readBoundedBody(request, maxBytes);
  const parts = splitMultipartParts(body, boundaryFromHeader(request.headers['content-type']));
  const projectParts = parts.filter((part) => part.name === 'project' && !part.filename);
  if (projectParts.length !== 1) throw new Error('案例数据必须且只能提交一次。');
  return {
    project: JSON.parse(projectParts[0].buffer.toString('utf8')),
    mediaParts: parts.filter((part) => part.name === 'media' && part.filename)
      .map((part) => ({ originalName: part.filename, mimeType: part.contentType, buffer: part.buffer }))
  };
}
~~~

Reject absent boundary, malformed JSON, duplicate project field, unnamed file part, and bodies above 501MB. This module must not write files.

- [ ] **Step 4: Register routes and map errors**

~~~js
if (request.method === 'GET' && pathname === '/api/portfolio/projects') {
  return sendJson(response, 200, {
    projects: await readPortfolioProjects({ includeUnpublished: url.searchParams.get('include') === 'all' })
  });
}
if (request.method === 'POST' && pathname === '/api/portfolio/projects') {
  const { project, mediaParts } = await readPortfolioMultipart(request, { maxBytes: 501 * 1024 * 1024 });
  return sendJson(response, 201, { project: await publishProject({ project, mediaParts }) });
}
~~~

PUT requires path id equal to project.id. PATCH returns 400 for status error and 404 unknown id. DELETE returns 204, 409 referenced, or 404 missing. Parser/validation errors return 400 with errorMessage; disk errors return 500 with “保存失败，请检查本机磁盘后重试。”. Add JPG/PNG/WebP MIME support only; retain MP4 Range logic.

- [ ] **Step 5: Run:** node --test test/portfolioRoutes.test.js test/offlineVideo.test.js  
Expected: PASS.

- [ ] **Step 6: Commit if Git is available**

~~~bash
git add src/portfolioMultipart.js src/server.js test/portfolioRoutes.test.js
git commit -m "feat: add local portfolio publishing API"
~~~

### Task 3: 构建公开作品集阅读体验

**Files:** Create public/portfolio.html, public/portfolio.js, public/portfolio.css; test test/portfolioUiContract.test.js.  
**Consumes:** GET projects route and project schema.  
**Produces:** Homepage, inline case reader, native image dialog and click-to-play video.

- [ ] **Step 1: Write failing UI contracts**

~~~js
test('portfolio has approved landmarks and content', async () => {
  const html = await readFile('public/portfolio.html', 'utf8');
  assert.match(html, /<nav aria-label="作品集导航">/);
  assert.match(html, /AI 产品与售前解决方案作品集/);
  assert.match(html, /id="featuredProjects"/);
  assert.match(html, /id="caseReader"/);
  assert.match(html, /业务理解.*AI 工作流设计.*原型与工程实现.*交付演示/s);
});
test('portfolio delays video and uses DOM text nodes', async () => {
  const js = await readFile('public/portfolio.js', 'utf8');
  assert.match(js, /video\.preload = 'none'/);
  assert.match(js, /video\.controls = true/);
  assert.match(js, /textContent = project\.title/);
  assert.doesNotMatch(js, /innerHTML\s*=.*project\./);
});
~~~

- [ ] **Step 2: Run:** node --test test/portfolioUiContract.test.js  
Expected: FAIL because pages are missing.

- [ ] **Step 3: Implement safe semantic rendering**

~~~js
async function loadProjects() {
  const response = await fetch('/api/portfolio/projects');
  if (!response.ok) throw new Error('作品集暂时无法加载。');
  return (await response.json()).projects;
}
function createProjectCard(project) {
  const title = document.createElement('h3');
  title.textContent = project.title;
  return title;
}
~~~

Use main, section, article, heading order and native dialog. Hero uses replaceable identity/contact placeholders, approved value proposition and local-demo notice. Published cards open the reader; coming_soon cards have no dead link. Reader order: value, manually started video, challenge, solution, media, delivery, previous/next.

- [ ] **Step 4: Implement refined CSS**

~~~css
:root { --paper:#f4f0e8; --ink:#161513; --muted:#6e6960; --accent:#9b4b36; }
@media (prefers-reduced-motion: no-preference) {
  .project-card { transition: transform 160ms ease, border-color 160ms ease; }
  .project-card:hover { transform: translateY(-3px); }
}
~~~

Use generous whitespace, strict grid, readable max-width, copper numbering, thin dividers and no shadows. Add visible focus, one-column below 720px, and no motion under reduce. Do not load remote fonts/scripts.

- [ ] **Step 5: Run:** node --test test/portfolioUiContract.test.js  
Expected: PASS.

- [ ] **Step 6: Commit if Git is available**

~~~bash
git add public/portfolio.html public/portfolio.js public/portfolio.css test/portfolioUiContract.test.js
git commit -m "feat: add refined portfolio reader"
~~~

### Task 4: 构建本机管理页与发布交互

**Files:** Create public/portfolio-admin.html, public/portfolio-admin.js; modify public/portfolio.css and test/portfolioUiContract.test.js.  
**Consumes:** Task 2 endpoints.  
**Produces:** Directly accessible but hidden-from-navigation management page.

- [ ] **Step 1: Add failing management UI contract**

~~~js
test('management keeps media local until explicit publication', async () => {
  const html = await readFile('public/portfolio-admin.html', 'utf8');
  const js = await readFile('public/portfolio-admin.js', 'utf8');
  assert.match(html, /id="projectForm"/);
  assert.match(html, /id="mediaInput"/);
  assert.match(html, /id="deleteMediaDialog"/);
  assert.match(js, /URL\.createObjectURL/);
  assert.match(js, /URL\.revokeObjectURL/);
  assert.match(js, /formData\.append\('project'/);
  assert.match(js, /formData\.append\('media'/);
});
~~~

- [ ] **Step 2: Run:** node --test test/portfolioUiContract.test.js  
Expected: FAIL because management page is missing.

- [ ] **Step 3: Implement preview and publish**

~~~js
function previewSelectedFiles(files) {
  revokePreviewUrls();
  state.pendingFiles = [...files];
  for (const file of state.pendingFiles) {
    const url = URL.createObjectURL(file);
    state.previewUrls.push(url);
    renderPreview(file, url);
  }
}
async function publishProject(event) {
  event.preventDefault();
  const formData = new FormData();
  formData.append('project', JSON.stringify(readProjectForm()));
  state.pendingFiles.forEach((file) => formData.append('media', file, file.name));
  const response = await fetch(state.editingId ? '/api/portfolio/projects/' + state.editingId : '/api/portfolio/projects', {
    method: state.editingId ? 'PUT' : 'POST', body: formData
  });
  if (!response.ok) throw new Error((await response.json()).errorMessage || '发布失败。');
}
~~~

Validate title, summary, role, year, value, challenge, 1-6 solution steps, delivery, alt text and file type/size before submit. Provide desktop/mobile preview, keep all entries on failure, use role=status, and revoke object URLs on replacement/reset/beforeunload.

- [ ] **Step 4: Implement edit, 下架 and protected delete**

~~~js
async function archiveProject(projectId) {
  return fetch('/api/portfolio/projects/' + projectId + '/status', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'archived' })
  });
}
async function confirmDeleteMedia(mediaId) {
  const response = await fetch('/api/portfolio/media/' + mediaId, { method: 'DELETE' });
  if (response.status === 409) showStatus('该媒体仍被案例引用，不能删除。', 'error');
}
~~~

UI label must be “下架” and must not delete its project. Media deletion opens a native confirmation dialog naming the file. No management link appears in portfolio.html.

- [ ] **Step 5: Run:** node --test test/portfolioUiContract.test.js  
Expected: PASS.

- [ ] **Step 6: Commit if Git is available**

~~~bash
git add public/portfolio-admin.html public/portfolio-admin.js public/portfolio.css test/portfolioUiContract.test.js
git commit -m "feat: add local portfolio manager"
~~~

### Task 5: 文档、回归与手工验收

**Files:** Modify README.md; test every suite.  
**Consumes:** Tasks 1-4.  
**Produces:** 本机使用说明和验收证据。

- [ ] **Step 1: Add local usage section**

~~~markdown
## 个人作品集（本机演示）

启动 npm start 后访问：
- http://localhost:5173/portfolio.html：对外展示页
- http://localhost:5173/portfolio-admin.html：本机内容管理页

选择媒体只会形成临时预览；点击“发布”才会保存。不要把管理页或环境变量文件发布到公网。
~~~

- [ ] **Step 2: Run:** npm test  
Expected: every existing and portfolio test passes.

- [ ] **Step 3: Run:** node --check public/portfolio.js; node --check public/portfolio-admin.js; node --check src/portfolioStore.js; node --check src/portfolioMultipart.js; node --check src/server.js  
Expected: every command exits 0.

- [ ] **Step 4: Run:** npm start  
Expected: Customer communication agent running at http://localhost:5173.

Manually verify desktop/mobile presentation; click-only video; keyboard-closable image dialog; pre-publish refresh creates no file; publish/edit/下架 work; invalid media has a readable error; referenced media cannot be deleted; existing meeting workspace, offline demo, model health, battle card and DOCX remain usable.

- [ ] **Step 5: Commit if Git is available**

~~~bash
git add README.md
git commit -m "docs: explain local portfolio workflow"
~~~

## Plan Self-Review

- **Spec coverage:** Tasks 1-2 cover persistence, validation, safe names, error handling and reference protection. Task 3 covers the approved refined visual system, accessibility, performance and safe reading. Task 4 covers temporary preview and publishing. Task 5 covers regression and manual acceptance.
- **No placeholders:** Paths, endpoints, limits, statuses, error behavior and checks are explicit.
- **Type consistency:** project, mediaParts, projectId, mediaId, statuses and store names remain consistent across all tasks.

