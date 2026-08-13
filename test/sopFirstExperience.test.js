import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { loadContent } from '../src/contentLoader.js';
import { buildChatMessages } from '../src/promptBuilder.js';

test('bundled customer communication content is meeting-type specific', async () => {
  const content = await loadContent();
  const typeA = content.scene.meetingTypes.find((type) => type.id === 'A');
  const typeB = content.scene.meetingTypes.find((type) => type.id === 'B');
  const typeC = content.scene.meetingTypes.find((type) => type.id === 'C');

  assert.equal(typeA.sopNodes[0].id, 'a_customer_research');
  assert.equal(typeB.sopNodes[0].id, 'b_interest_confirmation');
  assert.equal(typeC.sopNodes[0].id, 'c_report_goal_and_decision');
  assert.ok(content.skillPrompt.includes('Skill'));
  assert.ok(content.templates.before_meeting.length > 0);
  assert.ok(content.questions.byMeetingType.B.bySopNode.b_business_problem.length >= 2);
});

test('prompt rejects missing meeting type instead of defaulting to A', async () => {
  const content = await loadContent();

  assert.throws(
    () => buildChatMessages(content, {
      meetingType: '',
      sopNodeId: 'a_customer_research',
      userInput: 'Need help preparing for a first customer meeting.'
    }),
    /必须先选择交流类型/
  );
});

test('SOP-first UI removes node tags and moves recommendations into the chat panel', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="conversationSuggestions"/);
  assert.match(html, /id="questionMoreDialog"/);
  assert.doesNotMatch(html, /id="nodeQuestions"/);
  assert.doesNotMatch(html, /id="stageTabs"/);

  assert.match(app, /renderConversationSuggestions/);
  assert.match(app, /openQuestionMoreDialog/);
  assert.match(app, /intakeCompleted/);
  assert.doesNotMatch(app, /copySuggestedQuestion/);
  assert.doesNotMatch(app, /scene-tag/);
  assert.doesNotMatch(app, /node-question-panel/);
});
