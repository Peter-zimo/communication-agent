import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import mammoth from 'mammoth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadContent } from './contentLoader.js';
import { buildChatMessages } from './promptBuilder.js';
import { callModel, callModelStream, getModelConfig, mapModelError } from './modelClient.js';
import { resolveMeetingTask, recommendSopStep } from './taskRouter.js';
import { buildTaskMessages, validateTaskOutput } from './taskExecutor.js';
import { exportTaskResultDocx } from './docxExporter.js';
import { applyExtractedWorksheetFields, createWorksheet, worksheetToMarkdown } from './worksheet.js';
import { appendLiveRecordFields, applyMeetingExtraction, createMeetingWorkspace, extractionMessages, getMeetingGaps, normalizeMeetingWorkspace, parseMeetingExtraction } from './meetingWorkspace.js';
import { buildMeetingDocuments } from './documentBuilder.js';
import { parseBattleCardProposal } from './battleCardProposal.js';
import { cleanupPortfolioUpload, readPortfolioMultipart } from './portfolioMultipart.js';
import { isLoopbackAddress, isPortfolioWriteRequest } from './portfolioNetwork.js';
import { deleteUnusedMedia, publishProject, readPortfolioMediaLibrary, readPortfolioProjects, replaceProject, setProjectStatus, validateMediaPart, validateProjectInput } from './portfolioStore.js';
import { listCustomers, readCustomerHistory } from './customerStore.js';

const PORT = Number(process.env.PORT || 5173);
const DEFAULT_SCENE_ID = 'customer_communication';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORTFOLIO_MAX_REQUEST_BYTES = 501 * 1024 * 1024;
const PORTFOLIO_MEDIA_PATH = '/api/portfolio/media/';

const contentPromises = new Map();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;
    const sceneRequest = extractSceneRequest(pathname);

    if (isPortfolioWriteRequest(request.method, pathname) && !isLoopbackAddress(request.socket.remoteAddress)) {
      request.resume();
      return sendJson(response, 403, { errorMessage: '作品集写入仅允许从本机访问。' });
    }

    if (sceneRequest && request.method === 'GET' && sceneRequest.action === 'config') {
      const content = await getSceneContent(sceneRequest.sceneId);
      return sendJson(response, 200, { scene: content.scene, questions: content.questions, playbooks: content.playbooks, reviewTemplate: content.reviewTemplate, executionConfig: content.executionConfig });
    }

    if (request.method === 'GET' && request.url === '/api/customer-communication/model-health') {
      return checkModelHealth(response);
    }

    if (request.method === 'POST' && request.url === '/api/attachments/docx-text') {
      return parseDocxAttachment(request, response);
    }

    if (request.method === 'POST' && request.url === '/api/scenes/customer_communication/tasks/stream') {
      const body = await readJsonBody(request);
      const content = await getSceneContent(DEFAULT_SCENE_ID);
      const task = resolveMeetingTask(body);
      return streamTaskResponse(response, content, body, task);
    }

    if (request.method === 'POST' && request.url === '/api/scenes/customer_communication/steps/recommend') {
      const body = await readJsonBody(request); const content = await getSceneContent(DEFAULT_SCENE_ID);
      return sendJson(response, 200, { recommendation: recommendSopStep(content.scene, body.userInput || attachmentText(body.attachments)) });
    }

    if (request.method === 'POST' && request.url === '/api/scenes/customer_communication/steps/worksheet') {
      const body = await readJsonBody(request); const content = await getSceneContent(DEFAULT_SCENE_ID);
      const type = content.scene.meetingTypes.find((item) => item.id === body.meetingType);
      const node = type?.sopNodes.find((item) => item.id === body.sopNodeId && item.stage === body.stage);
      if (!node) return sendJson(response, 400, { errorMessage: '请选择有效的 SOP 步骤。' });
      const worksheet = createWorksheet(type.id, node);
      const sourceText = [body.userInput, attachmentText(body.attachments)].filter(Boolean).join('\n').slice(0, 12000);
      if (!sourceText) return sendJson(response, 200, { worksheet });
      try {
        const answer = await callModel(buildWorksheetExtractionMessages(type, node, sourceText));
        return sendJson(response, 200, { worksheet: applyExtractedWorksheetFields(worksheet, parseWorksheetExtraction(answer)) });
      } catch {
        return sendJson(response, 200, { worksheet, extractionWarning: '未能自动提取纪要内容，已保留待确认字段，可直接编辑。' });
      }
    }

    if (request.method === 'POST' && request.url === '/api/scenes/customer_communication/execution/extract') {
      const body = await readJsonBody(request);
      const content = await getSceneContent(DEFAULT_SCENE_ID);
      const sourceText = [body.userInput, attachmentText(body.attachments)].filter(Boolean).join('\n').trim();
      if (!sourceText) return sendJson(response, 400, { errorType: 'empty_input', errorMessage: '请粘贴会议内容或上传 Markdown、Word 文档。' });
      const task = resolveMeetingTask({ userInput: sourceText, taskId: 'after_meeting', meetingType: body.meetingType });
      if (!task.meetingType) {
        return sendJson(response, 200, {
          needsMeetingType: true,
          question: '请确认本次会议类型：A 初步交流、B 意向交流，还是 C 方案汇报？'
        });
      }
      const meetingType = content.scene.meetingTypes.find((item) => item.id === task.meetingType);
      const afterMeetingNode = meetingType?.sopNodes.find((item) => item.stage === 'after_meeting');
      const workspace = createMeetingWorkspace({
        meetingType: task.meetingType,
        sourceName: body.sourceName || '会议资料',
        sopNode: afterMeetingNode
      });
      try {
        const answer = await callModel(extractionMessages(workspace, sourceText));
        const extracted = parseMeetingExtraction(answer);
        const populated = applyMeetingExtraction(workspace, extracted);
        const enriched = appendLiveRecordFields(populated, body.liveRecords);
        return sendJson(response, 200, { workspace: enriched, gaps: getMeetingGaps(enriched), meetingTypeSource: task.meetingTypeSource });
      } catch (error) {
        const mapped = mapModelError(error);
        return sendJson(response, 502, mapped);
      }
    }

    if (request.method === 'POST' && request.url === '/api/scenes/customer_communication/execution/battle-card/optimize') {
      const body = await readJsonBody(request);
      const content = await getSceneContent(DEFAULT_SCENE_ID);
      const meetingType = content.scene.meetingTypes.find((item) => item.id === String(body.meetingType || '').toUpperCase());
      if (!meetingType) return sendJson(response, 400, { errorMessage: '请选择有效的会议类型 A、B 或 C。' });
      try {
        const optimization = await callModel(buildBattleCardOptimizationMessages(meetingType, body.session));
        return sendJson(response, 200, { optimization });
      } catch (error) {
        return sendJson(response, 502, mapModelError(error));
      }
    }

    if (request.method === 'POST' && request.url === '/api/scenes/customer_communication/execution/battle-card/optimize-stream') {
      const body = await readJsonBody(request);
      const content = await getSceneContent(DEFAULT_SCENE_ID);
      const meetingType = content.scene.meetingTypes.find((item) => item.id === String(body.meetingType || '').toUpperCase());
      if (!meetingType) return sendJson(response, 400, { errorMessage: '请选择有效的会议类型 A、B 或 C。' });
      return streamBattleCardOptimization(request, response, meetingType, body.session, body.battleCard);
    }

    if (request.method === 'POST' && request.url === '/api/scenes/customer_communication/execution/generate') {
      const body = await readJsonBody(request);
      const workspace = normalizeMeetingWorkspace(body.workspace);
      if (!workspace.meetingType || !Array.isArray(workspace.fields)) {
        return sendJson(response, 400, { errorType: 'invalid_workspace', errorMessage: '会议工作区数据不完整。' });
      }
      return sendJson(response, 200, buildMeetingDocuments(workspace));
    }

    if (request.method === 'POST' && request.url === '/api/scenes/customer_communication/execution/export-docx') {
      const body = await readJsonBody(request);
      const documents = buildMeetingDocuments(body.workspace);
      const generatedMarkdown = body.documentType === 'follow_up' ? documents.followUpMarkdown : documents.minutesMarkdown;
      const markdown = String(body.markdown || generatedMarkdown).trim();
      const defaultTitle = body.documentType === 'follow_up' ? `${documents.title}-跟进计划` : documents.title;
      const title = String(body.title || defaultTitle).trim();
      const file = await exportTaskResultDocx({ title, markdown });
      response.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename=meeting-document.docx' });
      return response.end(file);
    }

    if (request.method === 'POST' && request.url === '/api/scenes/customer_communication/tasks/export-docx') {
      const body = await readJsonBody(request);
      const markdown = body.worksheet ? worksheetToMarkdown(body.worksheet) : body.markdown;
      if (!String(markdown || '').trim()) return sendJson(response, 400, { errorType: 'invalid_task_output', errorMessage: '没有可导出的工作表内容。' });
      const file = await exportTaskResultDocx({ title: body.worksheet?.title || body.title || '会议工作表', markdown });
      response.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': "attachment; filename=meeting-review.docx" });
      return response.end(file);
    }

    if (sceneRequest && request.method === 'POST' && sceneRequest.action === 'chat') {
      const body = await readJsonBody(request);
      validateChatRequest(body);
      const content = await getSceneContent(sceneRequest.sceneId);
      const messages = buildChatMessages(content, body);
      const answer = await callModel(messages);
      return sendJson(response, 200, { answer });
    }

    if (sceneRequest && request.method === 'POST' && sceneRequest.action === 'chat-stream') {
      const body = await readJsonBody(request);
      validateChatRequest(body);
      const content = await getSceneContent(sceneRequest.sceneId);
      const messages = buildChatMessages(content, body);
      return streamChatResponse(response, messages);
    }

    if (request.method === 'GET' && pathname === '/api/portfolio/projects') {
      try {
        // include=all exposes management-only drafts and archived entries.
        const projects = await readPortfolioProjects({ includeUnpublished: url.searchParams.get('include') === 'all' });
        return sendJson(response, 200, { projects });
      } catch {
        return sendPortfolioStorageError(response);
      }
    }

    if (request.method === 'POST' && pathname === '/api/portfolio/projects') {
      const upload = await readPortfolioUpload(request, response);
      if (!upload) return;
      try {
        validatePortfolioUpload(upload);
        const project = await publishProject(upload);
        return sendJson(response, 201, { project });
      } catch (error) {
        return sendPortfolioWriteError(response, error);
      } finally {
        await cleanupPortfolioUpload(upload);
      }
    }

    const projectMatch = pathname.match(/^\/api\/portfolio\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (request.method === 'PUT' && projectMatch) {
      try {
        const projects = await readPortfolioProjects({ includeUnpublished: true });
        if (!projects.some((project) => project.id === projectMatch[1])) {
          return sendJson(response, 404, { errorMessage: '案例不存在。' });
        }
      } catch {
        return sendPortfolioStorageError(response);
      }
      const upload = await readPortfolioUpload(request, response);
      if (!upload) return;
      try {
        if (upload.project?.id !== projectMatch[1]) {
          await cleanupPortfolioUpload(upload);
          return sendJson(response, 400, { errorMessage: 'URL 中的案例 ID 必须与提交数据一致。' });
        }
        validatePortfolioUpload(upload);
        const project = await replaceProject(upload);
        return sendJson(response, 200, { project });
      } catch (error) {
        return sendPortfolioWriteError(response, error);
      } finally {
        await cleanupPortfolioUpload(upload);
      }
    }

    const statusMatch = pathname.match(/^\/api\/portfolio\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/status$/);
    if (request.method === 'PATCH' && statusMatch) {
      let body;
      try {
        body = await readJsonBody(request);
      } catch {
        return sendJson(response, 400, { errorMessage: '状态请求不符合要求。' });
      }
      try {
        const projects = await readPortfolioProjects({ includeUnpublished: true });
        if (!projects.some((project) => project.id === statusMatch[1])) {
          return sendJson(response, 404, { errorMessage: '案例不存在。' });
        }
        const project = await setProjectStatus(statusMatch[1], body.status);
        return sendJson(response, 200, { project });
      } catch (error) {
        if (isPortfolioStorageError(error)) return sendPortfolioStorageError(response);
        return sendJson(response, 400, { errorMessage: '状态请求不符合要求。' });
      }
    }

    if (request.method === 'GET' && pathname === '/api/portfolio/media') {
      try {
        return sendJson(response, 200, { media: await readPortfolioMediaLibrary() });
      } catch {
        return sendPortfolioStorageError(response);
      }
    }

    const mediaId = pathname.startsWith(PORTFOLIO_MEDIA_PATH) ? pathname.slice(PORTFOLIO_MEDIA_PATH.length) : '';
    if (request.method === 'DELETE' && /^[a-z0-9][a-z0-9-]*\.(?:jpg|png|webp|mp4)$/.test(mediaId)) {
      try {
        const confirmed = request.headers['x-portfolio-delete-confirm'] === 'delete';
        await deleteUnusedMedia(mediaId, { firstConfirmation: confirmed, secondConfirmation: confirmed });
        response.writeHead(204);
        return response.end();
      } catch (error) {
        if (error?.code === 'PORTFOLIO_MEDIA_REFERENCED') {
          return sendJson(response, 409, { errorMessage: '媒体仍被案例引用，不能删除。' });
        }
        if (error?.code === 'ENOENT') return sendJson(response, 404, { errorMessage: '媒体不存在。' });
        if (/二次确认/.test(error?.message || '')) return sendJson(response, 400, { errorMessage: '请明确确认删除媒体。' });
        if (isPortfolioStorageError(error)) return sendPortfolioStorageError(response);
        return sendJson(response, 400, { errorMessage: error?.message || '媒体删除请求不符合要求。' });
      }
    }

    // ─── 客户记忆 API ───
    if (request.method === 'GET' && pathname === '/api/customers') {
      const customers = await listCustomers();
      return sendJson(response, 200, customers);
    }

    const customerHistoryMatch = pathname.match(/^\/api\/customers\/(.+)\/history$/);
    if (request.method === 'GET' && customerHistoryMatch) {
      const customerName = decodeURIComponent(customerHistoryMatch[1]);
      const history = await readCustomerHistory(customerName);
      if (!history) return sendJson(response, 404, { errorType: 'not_found', errorMessage: '未找到该客户的历史记录。' });
      return sendJson(response, 200, history);
    }

    if (request.method === 'GET') {
      return serveStatic(request, response, pathname);
    }

    sendJson(response, 404, { errorType: 'not_found', errorMessage: 'API not found.' });
  } catch (error) {
    const mapped = mapModelError(error);
    const status = mapped.errorType === 'empty_input' ? 400 : 502;
    sendJson(response, status, mapped);
  }
});

async function readPortfolioUpload(request, response) {
  try {
    return await readPortfolioMultipart(request, { maxBytes: PORTFOLIO_MAX_REQUEST_BYTES });
  } catch (error) {
    sendJson(response, 400, { errorMessage: error?.message || '上传内容不符合要求。' });
    return null;
  }
}

function validatePortfolioUpload({ project, mediaParts }) {
  validateProjectInput(project);
  mediaParts.forEach(validateMediaPart);
}

function sendPortfolioWriteError(response, error) {
  if (isPortfolioStorageError(error)) return sendPortfolioStorageError(response);
  return sendJson(response, 400, { errorMessage: error?.message || '案例数据不符合要求。' });
}

function isPortfolioStorageError(error) {
  return Boolean(error?.code) || error instanceof SyntaxError;
}

function sendPortfolioStorageError(response) {
  return sendJson(response, 500, { errorMessage: '保存失败，请检查本机磁盘后重试。' });
}


async function parseDocxAttachment(request, response) {
  try {
    const body = await readBinaryBody(request, 2 * 1024 * 1024);
    const fileBuffer = extractMultipartFileBuffer(body, request.headers['content-type']);
    if (!fileBuffer.length) return sendJson(response, 400, { errorType: 'empty_file', errorMessage: '未读取到 Word 文档。' });
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return sendJson(response, 200, { text: String(result.value || '').slice(0, 12000) });
  } catch (error) {
    return sendJson(response, 400, { errorType: 'docx_parse_failed', errorMessage: error.message || 'Word 文档解析失败。' });
  }
}

function attachmentText(attachments) { return Array.isArray(attachments) ? attachments.map((item) => item.text || '').join('\n') : ''; }

function buildWorksheetExtractionMessages(type, node, sourceText) {
  return [
    {
      role: 'system',
      content: '你是售前会议工作表的信息抽取助手。只能使用提供的原始材料，不能补充、推断或改写为已确认事实。'
    },
    {
      role: 'user',
      content: [
        `会议类型：${type.id} 类 ${type.name}`,
        `当前阶段：${node.stage}`,
        `当前 SOP 步骤：${node.title}`,
        `仅允许填写以下必做项：${JSON.stringify(node.mustDo || [])}`,
        '请逐项抽取材料中明确出现的事实。没有明确依据时 value 填“待确认”。',
        '只输出 JSON，不要使用 Markdown：{"fields":[{"label":"必做项原文","value":"纪要中的明确事实或待确认"}]}',
        `原始材料：\n${sourceText}`
      ].join('\n')
    }
  ];
}

function parseWorksheetExtraction(answer) {
  const raw = String(answer || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return [];
  const parsed = JSON.parse(raw.slice(start, end + 1));
  return Array.isArray(parsed.fields) ? parsed.fields : [];
}

function buildBattleCardOptimizationMessages(meetingType, session = {}, battleCard = {}) {
  const beforeNodes = meetingType.sopNodes.filter((node) => node.stage === 'before_meeting');
  const guardrails = beforeNodes.flatMap((node) => node.guardrails || []);

  // 分析客户信息，提取关键上下文
  const customerAnalysis = analyzeCustomerContext(session);

  return [
    {
      role: 'system',
      content: [
        '你是售前会议会前准备助手。根据客户信息和 SOP 生成个性化、可操作的建议。',
        '规则：',
        '1. 只能根据用户提供的信息和 SOP 生成建议',
        '2. 不能把未知信息写成事实',
        '3. 不能承诺价格、周期、效果或交付范围',
        '4. 建议必须具体、可操作，避免泛泛而谈',
        '5. 优先问题要针对客户关注方向设计'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `【会议信息】`,
        `会议类型：${meetingType.id} 类 ${meetingType.name}`,
        `客户名称：${session.customerName || '待确认'}`,
        `会议背景：${session.background || '待确认'}`,
        ``,
        `【客户画像分析】`,
        customerAnalysis,
        ``,
        `【当前作战卡】`,
        JSON.stringify(battleCard, null, 2),
        ``,
        `【SOP 必做项】`,
        beforeNodes.flatMap((node) => node.mustDo || []).join('；'),
        ``,
        `【边界约束】`,
        guardrails.join('；'),
        ``,
        `【输出要求】`,
        '只输出 JSON，不要 Markdown、解释或其他字段：',
        '{',
        '  "meetingGoal": "不超过120字的会议目标，要体现客户关注点和本次会议预期成果",',
        '  "priorityQuestions": ["2-5条优先追问，要针对客户背景和关注方向设计"],',
        '  "materials": ["2-6项建议材料，要与客户关注方向匹配"],',
        '  "riskReminders": ["1-3条补充风险提醒，要结合会议类型和客户情况"]',
        '}',
        '',
        '要求：建议必须结合客户信息，不能删除或改写 SOP 必做项和边界。'
      ].join('\n')
    }
  ];
}

// 分析客户上下文信息
function analyzeCustomerContext(session) {
  const parts = [];

  // 分析参会对象
  const attendees = session.selections?.attendees;
  if (attendees?.length) {
    parts.push(`参会对象：${attendees.join('、')}`);
    if (attendees.includes('管理层')) {
      parts.push('  → 建议准备高层汇报材料，突出战略价值和投资回报');
    }
    if (attendees.includes('信息化人员')) {
      parts.push('  → 建议准备技术架构和集成方案');
    }
    if (attendees.includes('实际使用者')) {
      parts.push('  → 建议准备操作演示和用户体验案例');
    }
  }

  // 分析关注方向
  const focus = session.selections?.focus;
  if (focus?.length) {
    parts.push(`客户关注方向：${focus.join('、')}`);
    if (focus.includes('AI 应用')) {
      parts.push('  → 建议准备 AI 场景案例和效果数据');
    }
    if (focus.includes('行业案例')) {
      parts.push('  → 建议准备同行业成功案例');
    }
    if (focus.includes('业务数字化')) {
      parts.push('  → 建议准备数字化转型路径和价值分析');
    }
  }

  // 分析发起背景
  const background = session.selections?.background;
  if (background?.length) {
    parts.push(`会议发起背景：${background.join('、')}`);
  }

  // 分析我方角色
  const roles = session.selections?.roles;
  if (roles?.length) {
    parts.push(`我方角色分工：${roles.join('、')}`);
  }

  return parts.length ? parts.join('\n') : '暂无详细客户信息';
}

function readBinaryBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('单个文档不能超过 2MB。'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function extractMultipartFileBuffer(body, contentType = '') {
  const boundaryMatch = String(contentType).match(/boundary=(.+)$/i);
  if (!boundaryMatch) throw new Error('上传格式不正确。');
  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'));
  if (headerEnd === -1) throw new Error('上传内容不完整。');
  const fileStart = headerEnd + 4;
  const boundaryStart = body.indexOf(Buffer.from('\r\n'), fileStart);
  const nextBoundaryStart = body.indexOf(boundary, fileStart);
  const fileEnd = nextBoundaryStart > -1 ? nextBoundaryStart - 2 : boundaryStart;
  if (fileEnd <= fileStart) throw new Error('未读取到 Word 文档。');
  return body.subarray(fileStart, fileEnd);
}
function getSceneContent(sceneId) {
  if (!contentPromises.has(sceneId)) {
    contentPromises.set(sceneId, loadContent(sceneId));
  }
  return contentPromises.get(sceneId);
}
function sceneConfigPath(sceneId) {
  return `/api/scenes/${sceneId}/config`;
}

function sceneChatStreamPath(sceneId) {
  return `/api/scenes/${sceneId}/chat-stream`;
}

function extractSceneRequest(pathname) {
  const generic = pathname.match(/^\/api\/scenes\/([^/]+)\/(config|chat|chat-stream)$/);
  if (generic) {
    const sceneId = generic[1];
    if (sceneId !== DEFAULT_SCENE_ID) return null;
    return { sceneId, action: generic[2], configPath: sceneConfigPath(sceneId), chatStreamPath: sceneChatStreamPath(sceneId) };
  }

  const legacy = pathname.match(/^\/api\/customer-communication\/(config|chat|chat-stream)$/);
  if (legacy) return { sceneId: DEFAULT_SCENE_ID, action: legacy[1], legacy: true };
  return null;
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Customer communication agent running at http://localhost:${PORT}`);
});

async function checkModelHealth(response) {
  const startedAt = Date.now();
  const config = getModelConfig();

  try {
    await callModel([
      { role: 'system', content: '你是模型连通性检查助手。' },
      { role: 'user', content: '请只回复：OK' }
    ], { timeoutMs: Math.min(config.timeoutMs, 15000) });

    return sendJson(response, 200, {
      ok: true,
      endpoint: config.endpoint,
      model: config.model,
      timeoutMs: Math.min(config.timeoutMs, 15000),
      elapsedMs: Date.now() - startedAt
    });
  } catch (error) {
    if (error.code === 'MISSING_MEETING_TYPE') {
      return sendJson(response, 400, { errorType: 'missing_meeting_type', errorMessage: error.message });
    }
    const mapped = mapModelError(error);
    return sendJson(response, 502, {
      ok: false,
      endpoint: config.endpoint,
      model: config.model,
      timeoutMs: Math.min(config.timeoutMs, 15000),
      elapsedMs: Date.now() - startedAt,
      ...mapped
    });
  }
}

async function streamChatResponse(response, messages) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    Connection: 'keep-alive'
  });
  response.flushHeaders?.();
  sendSseEvent(response, 'ready', {});

  try {
    await callModelStream(messages, (content) => {
      sendSseEvent(response, 'delta', { content });
    });
    sendSseEvent(response, 'done', {});
  } catch (error) {
    sendSseEvent(response, 'error', mapModelError(error));
  } finally {
    response.end();
  }
}

async function streamTaskResponse(response, content, body, task) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', Connection: 'keep-alive' });
  response.flushHeaders?.();
  sendSseEvent(response, 'context', task);
  if (task.needsClarification) {
    sendSseEvent(response, 'clarification', { question: task.clarificationQuestion });
    sendSseEvent(response, 'done', {});
    return response.end();
  }
  try {
    const messages = buildTaskMessages(content, { ...body, task });
    await callModelStream(messages, (contentDelta) => sendSseEvent(response, 'delta', { content: contentDelta }));
    sendSseEvent(response, 'done', {});
  } catch (error) {
    sendSseEvent(response, 'error', mapModelError(error));
  }
  response.end();
}

async function streamBattleCardOptimization(request, response, meetingType, session, battleCard) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', Connection: 'keep-alive' });
  response.flushHeaders?.();
  sendSseEvent(response, 'ready', {});

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once('aborted', abort);
  response.once('close', abort);

  let rawProposal = '';
  let notifiedGenerating = false;
  try {
    const messages = buildBattleCardOptimizationMessages(meetingType, session, battleCard);
    await callModelStream(messages, (contentDelta) => {
      rawProposal += contentDelta;
      if (!notifiedGenerating) {
        notifiedGenerating = true;
        sendSseEvent(response, 'delta', { phase: 'validating' });
      }
    }, {
      timeoutMs: 45000,
      signal: controller.signal
    });
    if (!controller.signal.aborted) sendSseEvent(response, 'done', { proposal: parseBattleCardProposal(rawProposal) });
  } catch (error) {
    if (!controller.signal.aborted) {
      const mapped = error?.code === 'INVALID_BATTLE_CARD_PROPOSAL'
        ? { errorType: 'invalid_battle_card_proposal', errorMessage: error.message }
        : mapModelError(error);
      sendSseEvent(response, 'error', mapped);
    }
  } finally {
    request.removeListener('aborted', abort);
    response.removeListener('close', abort);
    if (!response.writableEnded) response.end();
  }
}

function sendSseEvent(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(response, 403, { errorType: 'forbidden', errorMessage: 'Forbidden path.' });
  }

  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error('Not a file');
    const type = contentType(filePath);
    const range = request.headers.range;
    if (type === 'video/mp4' && range) {
      const match = String(range).match(/^bytes=(\d*)-(\d*)$/);
      if (!match) {
        response.writeHead(416, { 'Content-Range': `bytes */${file.size}` });
        return response.end();
      }
      const start = match[1] ? Number(match[1]) : Math.max(file.size - Number(match[2]), 0);
      const end = match[2] ? Number(match[2]) : file.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= file.size) {
        response.writeHead(416, { 'Content-Range': `bytes */${file.size}` });
        return response.end();
      }
      const boundedEnd = Math.min(end, file.size - 1);
      response.writeHead(206, { 'Content-Type': type, 'Content-Length': boundedEnd - start + 1, 'Content-Range': `bytes ${start}-${boundedEnd}/${file.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store, max-age=0' });
      return pipeStaticFile(response, filePath, { start, end: boundedEnd });
    }
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': file.size, ...(type === 'video/mp4' ? { 'Accept-Ranges': 'bytes' } : {}), 'Cache-Control': 'no-store, max-age=0' });
    return pipeStaticFile(response, filePath);
  } catch {
    sendJson(response, 404, { errorType: 'not_found', errorMessage: 'Page not found.' });
  }
}

function pipeStaticFile(response, filePath, options) {
  const stream = createReadStream(filePath, options);
  stream.once('error', () => {
    if (!response.writableEnded) response.destroy();
  });
  response.once('close', () => stream.destroy());
  stream.pipe(response);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('request too large'));
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function validateChatRequest(body) {
  const meetingType = String(body.meetingType || '').toUpperCase();
  if (!['A', 'B', 'C'].includes(meetingType)) {
    const error = new Error('必须先选择交流类型 A/B/C。');
    error.code = 'MISSING_MEETING_TYPE';
    throw error;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function contentType(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.jpg')) return 'image/jpeg';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}






