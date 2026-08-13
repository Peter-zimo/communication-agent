import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('meeting type selection is a semi-gated scene entry step', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /id="intakeDialog"/);
  assert.match(html, /id="intakeMeetingTypes"/);
  assert.match(html, /id="intakeFields"/);
  assert.match(app, /intakeCompleted: false/);
  assert.match(app, /customerContext: \{\}/);
  assert.match(app, /function renderIntakeDialog/);
  assert.match(app, /function submitIntake/);
  assert.match(app, /function currentMeetingTypeConfig/);
  assert.doesNotMatch(app, /function classificationNodeId\(\)/);
  assert.doesNotMatch(app, /renderMeetingTypePlaybooks\(\)/);
  assert.doesNotMatch(app, /stageTabs/);
  assert.doesNotMatch(app, /playbookPanel/);
});

test('intake required fields block workspace entry until filled', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="intakeError"/);
  assert.match(app, /input\.placeholder = field\.required \? '必填项' : '可选项'/);
  assert.match(app, /function missingRequiredIntakeFields/);
  assert.match(app, /const customerContext = currentIntakeContext\(\)/);
  assert.match(app, /const missingFields = missingRequiredIntakeFields\(type, customerContext\)/);
  assert.match(app, /if \(missingFields\.length\)/);
  assert.match(app, /请补充必填项：/);
  assert.match(app, /return;/);
  assert.match(app, /state\.intakeCompleted = true/);
  assert.ok(app.indexOf('if (missingFields.length)') < app.indexOf('applyMeetingType(type, customerContext, { complete: true })'));
  assert.doesNotMatch(app, /input\.placeholder = '不清楚可留空，AI 会提示待补充'/);
  assert.match(app, /input\.placeholder = field\.required \? '必填项' : '可选项'/);
});

test('intake error message is rendered inside dialog for missing required fields', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /class="intake-error hidden"/);
  assert.match(app, /function renderIntakeError/);
  assert.match(app, /function clearIntakeError/);
  assert.match(app, /renderIntakeError\(`请补充必填项：/);
  assert.match(css, /\.intake-error \{/);
});

test('AI composer sends with Shift Enter and keeps Enter for new lines', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /keydown/);
  assert.match(app, /event\.key === 'Enter'/);
  assert.match(app, /event\.shiftKey/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /sendMessage\(\)/);
});

test('SOP nodes render modal details with the planned sections', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.doesNotMatch(html, /id="nodeModal"/);
  assert.doesNotMatch(html, /currentNodePanel/);
  assert.doesNotMatch(app, /function renderCurrentNodeDetail/);
  assert.match(html, /id="nodeDetailDialog"/);
  assert.match(app, /function openNodeDetailDialog/);
  assert.match(app, /function refreshOpenNodeDetailDialog/);
  assert.match(app, /function renderDetailAccordion/);
  assert.match(app, /function toggleAllNodeSections/);
  assert.match(app, /\u672c\u8282\u5173\u6ce8\u70b9/);
  assert.match(app, /\u5fc5\u505a\u9879/);
  assert.match(app, /\u5efa\u8bae\u9879/);
  assert.match(app, /\u7ecf\u9a8c\u63d0\u9192/);
  assert.match(app, /\u5e38\u89c1\u9519\u8bef/);
  assert.doesNotMatch(app, /id: 'aiQuestions'/);
  assert.match(app, /\u672c\u8282\u70b9\u8f93\u51fa\u7269/);
  assert.match(app, /\u76f8\u5173\u8d44\u6599\u5165\u53e3/);
});

test('modal node detail renders accordion sections without ABC playbooks', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const start = app.indexOf('function renderNodeDetailDialogContent');
  const end = app.indexOf('function bindNodeDetailDialogEvents');
  const body = app.slice(start, end);

  assert.match(body, /detail-accordion-list/);
  assert.doesNotMatch(body, /renderMeetingTypePlaybooks/);
});

test('missing meeting type opens intake instead of skip-step warning', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="intakeDialog"/);
  assert.match(app, /请先选择 A\/B\/C 交流类型。/);
  assert.match(app, /showModal\(els\.intakeDialog\)/);
  assert.doesNotMatch(app, /function shouldWarnBeforeNode/);
  assert.doesNotMatch(app, /classificationRequiredBeforeStep\(\)/);
});

test('AI chat uses SSE streaming endpoint', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /sceneId: 'customer_communication'/);
  assert.match(app, /\/api\/scenes\/\$\{state\.sceneId\}\/config/);
  assert.match(app, /\/api\/scenes\/\$\{state\.sceneId\}\/chat-stream/);
  assert.match(app, /response\.body\.getReader\(\)/);
  assert.match(app, /TextDecoder/);
  assert.match(app, /appendAssistantMessage/);
  assert.match(app, /updateMessageContent/);
});

test('AI chat sends meeting type and customer context', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /meetingType: state\.meetingType/);
  assert.match(app, /customerContext: state\.customerContext/);
  assert.match(app, /taskId: taskIdForCurrentNode\(\)/);
  assert.match(app, /sopNodeId: state\.sopNodeId/);
  assert.match(app, /selectedRecommendedQuestion: state\.selectedRecommendedQuestion/);
  assert.match(app, /const conversationHistory = recentConversationHistory\(\)/);
});

test('AI composer routes input through step recognition before creating a worksheet', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="stepConfirmation"/);
  assert.match(html, /id="worksheet"/);
  assert.match(app, /function requestStepRecommendation/);
  assert.match(app, /await requestStepRecommendation\(messageInput, attachmentSnapshot\)/);
  assert.match(app, /function renderPendingStepControls/);
  assert.match(app, /function updatePendingStepSelection/);
  assert.match(app, /function loadWorksheet/);
  assert.match(app, /确认并生成工作表/);
  assert.match(app, /steps\/recommend/);
  assert.match(app, /steps\/worksheet/);
});


test('customer sync extraction covers natural customer descriptions', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /客户是/);
  assert.match(app, /主要做/);
  assert.match(app, /已有系统是/);
  assert.match(app, /关键人是/);
  assert.match(app, /本次交流背景/);
  assert.match(app, /参会最高层级/);
  assert.match(app, /departmentOrScenario/);
  assert.match(app, /decisionOwner/);
  assert.match(app, /budgetIntent/);
  assert.match(app, /customerConcern/);
  assert.match(app, /demoTopic/);
  assert.match(app, /expectedOutput/);
  assert.match(app, /customerFocus/);
  assert.match(app, /nextStepGoal/);
  assert.doesNotMatch(app, /fieldId: 'knownInterest'/);
  assert.doesNotMatch(app, /fieldId: 'demoReadiness'/);
});
test('conversation suggestions provide compact more actions without copy', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="conversationSuggestions"/);
  assert.match(html, /id="questionMoreDialog"/);
  assert.match(app, /renderConversationSuggestions/);
  assert.match(app, /openQuestionMoreDialog/);
  assert.match(app, /message-related/);
  assert.match(app, /more-trigger/);
  assert.doesNotMatch(app, /copySuggestedQuestion/);
  assert.doesNotMatch(app, /\u590d\u5236/);
});

test('assistant loading state uses only animated dots without helper copy', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(app, /loading-dots/);
  assert.match(css, /loading-dots/);
  assert.match(css, /@keyframes loading-dots/);
  assert.match(css, /nth-child\(2\)/);
  assert.match(css, /nth-child\(3\)/);
  assert.doesNotMatch(app, /正在基于当前类型、阶段和节点生成建议/);
  assert.doesNotMatch(app, /AI 正在生成/);
});


