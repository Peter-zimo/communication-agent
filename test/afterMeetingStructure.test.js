import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { loadContent } from '../src/contentLoader.js';
import { buildChatMessages } from '../src/promptBuilder.js';

test('after-meeting content keeps one node per type and separates review from follow-up', async () => {
  const content = await loadContent('customer_communication');
  const afterTemplate = content.templates.after_meeting;

  for (const type of content.scene.meetingTypes) {
    assert.equal(type.sopNodes.filter((node) => node.stage === 'after_meeting').length, 1);
  }

  assert.ok(afterTemplate.indexOf('## 1. 对内复盘') < afterTemplate.indexOf('## 2. 对外跟进'));
  assert.ok(afterTemplate.indexOf('### 1.1 本次交流结论') < afterTemplate.indexOf('### 2.1 客户侧行动项'));
  assert.match(afterTemplate, /### 2\.4 下一次交流建议/);
  assert.doesNotMatch(content.templates.before_meeting, /对内复盘/);
  assert.doesNotMatch(content.templates.during_meeting, /对外跟进/);
});

test('after-meeting recommended questions cover internal review and external follow-up', async () => {
  const content = await loadContent('customer_communication');

  assert.match(content.questions.byMeetingType.A.bySopNode.a_after_meeting_interest.join('\n'), /对内复盘/);
  assert.match(content.questions.byMeetingType.A.bySopNode.a_after_meeting_interest.join('\n'), /对外跟进/);
  assert.match(content.questions.byMeetingType.B.bySopNode.b_after_meeting_gaps.join('\n'), /对外跟进行动清单/);
  assert.match(content.questions.byMeetingType.C.bySopNode.c_after_meeting_actions.join('\n'), /客户侧和我方责任动作/);
});

test('after-meeting prompt injects two-level title order and excludes other stages', async () => {
  const content = await loadContent('customer_communication');
  const messages = buildChatMessages(content, {
    meetingType: 'B',
    sopNodeId: 'b_after_meeting_gaps',
    userInput: '会后怎么安排下一步？'
  });

  const text = messages[1].content;
  const internalReview = text.indexOf('## 1. 对内复盘');
  const conclusion = text.indexOf('### 1.1 本次交流结论');
  const externalFollowup = text.indexOf('## 2. 对外跟进');
  const customerActions = text.indexOf('### 2.1 客户侧行动项');

  assert.ok(internalReview > -1);
  assert.ok(internalReview < conclusion && conclusion < externalFollowup && externalFollowup < customerActions);
  assert.match(text, /必须优先使用当前阶段模板中的标题结构/);
  assert.match(text, /二级标题下的行动项、选项、下一步动作、风险和建议统一使用 - 无序列表/);
  assert.match(text, /二级标题下不得输出数字序号、跳号或重复编号/);
  assert.doesNotMatch(text, /行动清单必须从 1 开始连续编号/);
  assert.doesNotMatch(text, /## 1\. 本次交流定位/);
  assert.doesNotMatch(text, /## 1\. 真实问题判断/);
});

test('node detail dialog adds review and follow-up grouping only for after-meeting nodes', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /function afterMeetingMustDoGroupsForNode\(node\)/);
  assert.match(app, /function enrichDetailSectionForNode\(node, section\)/);
  assert.match(app, /section\.id !== 'mustDo'/);
  assert.match(app, /item\.includes\('客户侧行动项'\)/);
  assert.match(app, /item\.includes\('下一次交流主题'\)/);
  assert.doesNotMatch(app, /id: 'aiQuestions'/);
});
