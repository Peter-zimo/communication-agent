import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('home page shell exposes the sales SOP workspace entry', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /售前工程师 SOP 工作台/);
  assert.match(html, /id="homeView"/);
  assert.match(html, /id="sceneView"/);
  assert.match(app, /客户交流会议/);
  assert.match(app, /需求澄清/);
  assert.match(app, /POC 规划/);
  assert.match(app, /后续完善/);
  assert.doesNotMatch(app, /智能调研工作流/);
});

test('customer communication entry groups SOP learning and meeting execution workspaces', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const execution = await readFile('public/execution.js', 'utf8');

  assert.match(app, /客户交流会议/);
  assert.match(html, /id="meetingEntryDialog"/);
  assert.match(html, /SOP 学习与问答/);
  assert.match(html, /会议执行助手/);
  assert.match(html, /id="openSopLearning"/);
  assert.match(html, /id="openMeetingExecution"/);
  assert.match(app, /openMeetingAssistant\('sop_learning'\)/);
  assert.match(app, /openMeetingAssistant\('meeting_execution'\)/);
  assert.match(html, /id="executionView"/);
  assert.match(html, /确认提取结果/);
  assert.match(execution, /execution\/extract/);
  assert.match(execution, /execution\/generate/);
  assert.match(execution, /markdown: els\.preview\.value/);
  assert.match(html, /id="beforeExecutionStage"/);
  assert.match(html, /id="duringExecutionStage"/);
  assert.match(html, /id="afterExecutionStage"/);
  assert.match(execution, /generateBattleCard/);
  assert.match(execution, /addLiveRecord/);
  assert.match(execution, /prepareAfterMeeting/);
  assert.match(html, /导出 Word/);
});

test('battle-card materials use scoped checkbox cards instead of full-width inputs', async () => {
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(styles, /\.check-list \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.check-list input\[type="checkbox"\] \{[^}]*width: 16px[^}]*height: 16px/s);
  assert.match(styles, /\.check-list label:has\(input:checked\)/);
});

test('live key items use scoped checkbox cards instead of full-width inputs', async () => {
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(styles, /\.live-key-items \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.live-key-items input\[type="checkbox"\] \{[^}]*width: 16px[^}]*height: 16px/s);
  assert.match(styles, /\.live-key-items label:has\(input:checked\)/);
});

test('current public entry only loads the active app bundle', async () => {
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /\/app\.js/);
  assert.doesNotMatch(html, /shell\.js/);
  assert.doesNotMatch(html, /chat-panel\.js/);
  assert.doesNotMatch(html, /scenes\/customer-communication\.js/);
});

test('workspace requires step confirmation before it requests an editable worksheet', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="stepConfirmation"/);
  assert.match(html, /id="worksheet"/);
  assert.match(app, /当前阶段<select id="confirmStage"/);
  assert.match(app, /确认并生成工作表/);
  assert.match(app, /steps\/recommend/);
  assert.match(app, /steps\/worksheet/);
  assert.match(app, /selectMeetingTypeForSop/);
  assert.match(app, /currentWorksheet/);
});

test('assistant panel hides empty workflow regions and keeps composer controls inside its input shell', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.doesNotMatch(html, /id="exportDocxButton"/);
  assert.match(app, /worksheet-head/);
  assert.match(app, /id="exportDocxButton"/);
  assert.match(styles, /\.step-confirmation:empty,\s*\.conversation-suggestions:empty\s*\{\s*display: none/);
  assert.match(styles, /\.composer-input-shell\s*\{[\s\S]*position: relative/);
  assert.match(styles, /\.composer-attach\s*\{[\s\S]*position: absolute/);
  assert.match(styles, /#sendButton\s*\{[\s\S]*position: absolute/);
});

test('customer-facing assets do not expose development or personal traces', async () => {
  const files = [
    'public/index.html',
    'public/app.js',
    'content/source/customer_communication_skill.md',
    'content/scenes/customer_communication/source/customer_communication_skill.md'
  ];
  const forbidden = /Rainey|Codex|PRD|内部讨论|修改痕迹/;

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, forbidden, file);
  }
});

