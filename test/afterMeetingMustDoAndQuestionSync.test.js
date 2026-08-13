import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { loadContent } from '../src/contentLoader.js';

const EXPECTED_AFTER_MEETING_GROUPS = {
  A: {
    internal: [
      '整理客户关键原话、兴趣点、质疑点和下一步责任人。',
      '判断客户最有反应的方向和可能跟进科室。',
      '记录客户已有系统或友商线索。'
    ],
    external: ['明确建议下一次交流主题和客户侧联系人。']
  },
  B: {
    internal: [
      '整理初步业务场景、真实问题、使用角色、数据来源和数据条件。',
      '记录客户已有系统或友商情况、维泰可能差分点、当前信息缺口。',
      '判断下一步进入需求澄清、POC规划、方案交流、继续技术交流、AE推进或暂缓。'
    ],
    external: ['明确客户侧行动项、我方行动项、责任人和时间点。']
  },
  C: {
    internal: [
      '整理客户对方案或 POC 的反馈、认可点和质疑点。',
      '记录需要补充的内容。',
      '判断是否具备立项或扩大试点可能。',
      '识别决策链和关键推动人。'
    ],
    external: ['明确客户侧行动项、我方行动项、责任人和时间点。']
  }
};

test('after-meeting must-do grouping uses only existing mustDo items', async () => {
  const content = await loadContent('customer_communication');

  for (const type of content.scene.meetingTypes) {
    const node = type.sopNodes.find((item) => item.stage === 'after_meeting');
    const expected = EXPECTED_AFTER_MEETING_GROUPS[type.id];
    const groupedItems = [...expected.internal, ...expected.external];

    assert.deepEqual(groupedItems, node.mustDo);
    assert.equal(new Set(groupedItems).size, node.mustDo.length);
  }

  assert.notDeepEqual(EXPECTED_AFTER_MEETING_GROUPS.A, EXPECTED_AFTER_MEETING_GROUPS.B);
  assert.notDeepEqual(EXPECTED_AFTER_MEETING_GROUPS.B, EXPECTED_AFTER_MEETING_GROUPS.C);
});

test('app renders after-meeting review and follow-up inside must-do instead of a standalone section', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.doesNotMatch(app, /AFTER_MEETING_REVIEW_GROUPS/);
  assert.doesNotMatch(app, /afterMeetingReviewFollowup/);
  assert.doesNotMatch(app, /会后闭环/);
  assert.match(app, /afterMeetingMustDoGroupsForNode/);
  assert.match(app, /section\.id !== 'mustDo'/);
  assert.match(app, /function afterMeetingMustDoGroupsForNode\(node\)/);
  assert.match(app, /item\.includes\('客户侧行动项'\)/);
});

test('question recommendations refresh when the selected SOP node changes', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const selectSopNode = app.match(/function selectSopNode\(nodeId\) \{([\s\S]*?)\n\}/);
  const openQuestionMoreDialog = app.match(/function openQuestionMoreDialog[\s\S]*?\n\}/);

  assert.ok(selectSopNode, 'selectSopNode should exist');
  assert.match(selectSopNode[1], /state\.selectedRecommendedQuestion = null/);
  assert.match(selectSopNode[1], /renderConversationSuggestions\(\)/);
  assert.match(selectSopNode[1], /renderChat\(\)/);

  assert.ok(openQuestionMoreDialog, 'openQuestionMoreDialog should exist');
  assert.match(openQuestionMoreDialog[0], /questionsForCurrentNode\('all', 12\)/);
});
