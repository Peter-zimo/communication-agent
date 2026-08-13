import test from 'node:test';
import assert from 'node:assert/strict';

import { loadContent } from '../src/contentLoader.js';
import { createMeetingWorkspace } from '../src/meetingWorkspace.js';

test('loadContent reads bundled scene configuration and prompt assets', async () => {
  const content = await loadContent();

  assert.equal(content.scene.sceneId, 'customer_communication');
  assert.ok(content.scene.sceneName);
  assert.ok(content.skillPrompt.length > 0);
  assert.ok(content.templates.before_meeting.length > 0);
  assert.ok(content.questions.byMeetingType.A.bySopNode.a_customer_research.length > 0);
  assert.equal(content.executionConfig.recordTypes.length, 7);
  assert.deepEqual(Object.keys(content.executionConfig.byMeetingType), ['A', 'B', 'C']);
});

test('loadContent exposes A/B/C intake schemas and dedicated SOP nodes', async () => {
  const content = await loadContent('customer_communication');
  const byType = Object.fromEntries(content.scene.meetingTypes.map((type) => [type.id, type]));

  assert.deepEqual(Object.keys(byType), ['A', 'B', 'C']);
  assert.deepEqual(
    byType.A.intakeSchema.map(({ id, label, required }) => ({ id, label, required })),
    [
      { id: 'customerName', label: '客户单位名称', required: true },
      { id: 'mainBusiness', label: '主营业务', required: true },
      { id: 'meetingBackground', label: '本次交流背景', required: true },
      { id: 'participantLevel', label: '参会人员及最高层级', required: false },
      { id: 'existingSystems', label: '已有系统建设情况', required: false }
    ]
  );
  assert.deepEqual(
    byType.B.intakeSchema.map(({ id, label, required }) => ({ id, label, required })),
    [
      { id: 'customerName', label: '客户单位名称', required: true },
      { id: 'departmentOrScenario', label: '对接科室或业务场景', required: true },
      { id: 'decisionOwner', label: '决策者或负责人', required: true },
      { id: 'budgetIntent', label: '预算或采购意愿', required: true },
      { id: 'customerConcern', label: '客户当前态度或主要顾虑', required: false },
      { id: 'meetingGoal', label: '本次交流目标或需要推动的结果', required: false }
    ]
  );
  assert.deepEqual(
    byType.C.intakeSchema.map(({ id, label, required }) => ({ id, label, required })),
    [
      { id: 'customerName', label: '客户单位名称', required: true },
      { id: 'reportGoal', label: '汇报目标', required: true },
      { id: 'demoTopic', label: 'Demo / 方案主题', required: true },
      { id: 'expectedOutput', label: '本次汇报预期产出', required: true },
      { id: 'customerFocus', label: '客户重点关注问题', required: true },
      { id: 'nextStepGoal', label: '汇报后推进目标', required: false }
    ]
  );

  assert.deepEqual(
    byType.A.sopNodes.map((node) => node.id),
    ['a_customer_research', 'a_background_and_roles', 'a_material_preparation', 'a_meeting_guidance', 'a_after_meeting_interest']
  );
  assert.deepEqual(
    byType.B.sopNodes.map((node) => node.id),
    ['b_interest_confirmation', 'b_business_problem', 'b_roles_and_decision_chain', 'b_data_systems_competitors', 'b_poc_or_solution_judgement', 'b_after_meeting_gaps']
  );
  assert.equal(byType.B.sopNodes[1].title, '业务场景假设与真实问题拆解');
  assert.deepEqual(
    byType.C.sopNodes.map((node) => node.id),
    ['c_report_goal_and_decision', 'c_demo_solution_readiness', 'c_value_boundary_risk', 'c_feedback_collection', 'c_trial_poc_project_judgement', 'c_after_meeting_actions']
  );

  assert.equal(content.sourceDir.endsWith('content\\scenes\\customer_communication') || content.sourceDir.endsWith('content/scenes/customer_communication'), true);
});

test('A/B/C SOP nodes declare explicit meeting stages', async () => {
  const content = await loadContent('customer_communication');
  const allowedStages = new Set(['before_meeting', 'during_meeting', 'after_meeting']);
  const expectedCounts = { A: 5, B: 6, C: 6 };

  for (const type of content.scene.meetingTypes) {
    assert.equal(type.sopNodes.length, expectedCounts[type.id]);
    const stages = new Set(type.sopNodes.map((node) => node.stage));
    assert.deepEqual([...stages].sort(), ['after_meeting', 'before_meeting', 'during_meeting']);
    for (const node of type.sopNodes) {
      assert.ok(allowedStages.has(node.stage), `${type.id}/${node.id} has invalid stage ${node.stage}`);
    }
  }
});

test('execution fields cover every A/B/C after-meeting SOP must-do item', async () => {
  const content = await loadContent();

  for (const type of content.scene.meetingTypes) {
    const afterMeetingNode = type.sopNodes.find((node) => node.stage === 'after_meeting');
    const workspace = createMeetingWorkspace({ meetingType: type.id, sopNode: afterMeetingNode });
    const labels = new Set(workspace.fields.map((field) => field.label));

    assert.ok(afterMeetingNode.mustDo.length > 0, `${type.id} 类缺少会后必做项`);
    afterMeetingNode.mustDo.forEach((mustDo) => {
      assert.ok(labels.has(mustDo), `${type.id} 类执行助手缺少字段：${mustDo}`);
    });
  }
});

test('after meeting template and recommendations separate internal review from external follow-up', async () => {
  const content = await loadContent('customer_communication');
  const afterTemplate = content.templates.after_meeting;

  assert.ok(afterTemplate.indexOf('## 1. 对内复盘') < afterTemplate.indexOf('## 2. 对外跟进'));
  assert.ok(afterTemplate.indexOf('### 1.1 本次交流结论') < afterTemplate.indexOf('### 2.1 客户侧行动项'));
  assert.match(afterTemplate, /### 2\.4 下一次交流建议/);
  assert.doesNotMatch(content.templates.before_meeting, /对内复盘/);
  assert.doesNotMatch(content.templates.during_meeting, /对外跟进/);

  assert.equal(content.scene.meetingTypes.filter((type) => type.sopNodes.filter((node) => node.stage === 'after_meeting').length === 1).length, 3);
  assert.match(content.questions.byMeetingType.A.bySopNode.a_after_meeting_interest.join('\n'), /对内复盘/);
  assert.match(content.questions.byMeetingType.B.bySopNode.b_after_meeting_gaps.join('\n'), /对外跟进行动清单/);
  assert.match(content.questions.byMeetingType.C.bySopNode.c_after_meeting_actions.join('\n'), /客户侧和我方责任动作/);
});
