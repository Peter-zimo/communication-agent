import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('customer communication page uses top SOP flow with modal node details', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="sopList"/);
  assert.match(html, /id="intakeDialog"/);
  assert.match(html, /id="conversationSuggestions"/);
  assert.match(html, /id="questionMoreDialog"/);
  assert.doesNotMatch(html, /id="meetingTypeCards"/);
  assert.doesNotMatch(html, /id="nodeModal"/);
  assert.doesNotMatch(html, /id="stageTabs"/);
  assert.doesNotMatch(html, /id="nodeQuestions"/);
  assert.match(app, /renderIntakeDialog/);
  assert.doesNotMatch(app, /renderMeetingTypePlaybooks/);
  assert.doesNotMatch(html, /currentNodePanel/);
  assert.doesNotMatch(app, /renderCurrentNodeDetail/);
  assert.match(html, /id="nodeDetailDialog"/);
  assert.match(app, /openNodeDetailDialog/);
  assert.match(app, /renderDetailAccordion/);
  assert.match(app, /section\.groups/);
  assert.match(app, /detail-group-list/);
  assert.match(app, /detail-group-title/);
  assert.match(app, /node-detail-tools/);
  assert.match(app, /data-action="toggle-all"/);
  assert.match(app, /全部展开\/折叠/);
  assert.doesNotMatch(app, /`\$\{section\.title\}：\$\{item\}`/);
  assert.match(app, /STAGE_DEFS/);
  assert.match(app, /renderStageFlow/);
  assert.match(app, /nodesForStage/);
  assert.match(app, /当前阶段打法/);
  assert.match(app, /before_meeting/);
  assert.match(app, /during_meeting/);
  assert.match(app, /after_meeting/);
  assert.match(app, /renderConversationSuggestions/);
  assert.match(app, /more-trigger/);
  assert.match(app, /\u672c\u8282\u5173\u6ce8\u70b9/);
  assert.match(app, /\u5e38\u89c1\u9519\u8bef/);
  assert.doesNotMatch(app, /id: 'aiQuestions'/);
  assert.match(app, /\u672c\u8282\u70b9\u8f93\u51fa\u7269/);
  assert.match(app, /\u76f8\u5173\u8d44\u6599\u5165\u53e3/);
  assert.doesNotMatch(html, /7 个节点/);
});

test('AI panel exposes model health diagnostics', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="modelHealthSlot"/);
  assert.match(app, /createModelHealthControls/);
  assert.match(app, /modelHealthButton/);
  assert.match(app, /model-health/);
});
