import test from 'node:test';
import assert from 'node:assert/strict';

import { appendLiveRecordFields, applyMeetingExtraction, createMeetingWorkspace, getMeetingGaps } from '../src/meetingWorkspace.js';
import { buildMeetingDocuments } from '../src/documentBuilder.js';

const A_AFTER_MEETING_NODE = {
  id: 'a_after_meeting_interest',
  mustDo: ['整理客户关键原话、兴趣点、质疑点和下一步责任人。', '判断客户最有反应的方向和可能跟进科室。']
};

test('creates a post-meeting workspace with stable field ids and missing statuses', () => {
  const workspace = createMeetingWorkspace({ meetingType: 'B' });
  assert.equal(workspace.stage, 'after_meeting');
  assert.equal(workspace.fields.find((field) => field.id === 'executive_contact').status, 'missing');
  assert.equal(workspace.fields.find((field) => field.id === 'executive_contact').requirement, 'required');
});

test('extracted values remain pending and retain evidence', () => {
  const workspace = applyMeetingExtraction(createMeetingWorkspace({ meetingType: 'A' }), [
    { id: 'meeting_conclusion', value: '客户认可继续交流', evidence: '客户表示可以安排下一轮交流', confidence: 0.86 }
  ]);
  const field = workspace.fields.find((item) => item.id === 'meeting_conclusion');
  assert.equal(field.status, 'pending');
  assert.equal(field.evidence, '客户表示可以安排下一轮交流');
});

test('creates required extraction fields from the selected type after-meeting SOP node', () => {
  const workspace = createMeetingWorkspace({ meetingType: 'A', sopNode: A_AFTER_MEETING_NODE });
  const sopFields = workspace.fields.filter((field) => field.group === 'sop_required');

  assert.deepEqual(sopFields.map((field) => field.label), A_AFTER_MEETING_NODE.mustDo);
  assert.ok(sopFields.every((field) => field.requirement === 'required'));
  assert.equal(workspace.sopNodeId, A_AFTER_MEETING_NODE.id);
});

test('confirmed SOP required fields appear in the formal minutes', () => {
  const workspace = createMeetingWorkspace({ meetingType: 'A', sopNode: A_AFTER_MEETING_NODE });
  workspace.fields[0].value = '客户关注数据治理，张经理负责组织下一次交流';
  workspace.fields[0].status = 'confirmed';

  const documents = buildMeetingDocuments(workspace);
  assert.match(documents.minutesMarkdown, /SOP 必做项确认/);
  assert.match(documents.minutesMarkdown, /客户关注数据治理/);
});

test('formal documents use confirmed facts only and list pending candidates separately', () => {
  const workspace = applyMeetingExtraction(createMeetingWorkspace({ meetingType: 'C' }), [
    { id: 'meeting_conclusion', value: '客户认可方案方向', evidence: '认可方向', confidence: 0.9 },
    { id: 'customer_needs', value: '需要统一数据口径', evidence: '数据口径不一致', confidence: 0.8 }
  ]);
  workspace.fields.find((field) => field.id === 'meeting_conclusion').status = 'confirmed';
  const documents = buildMeetingDocuments(workspace);
  const confirmedFacts = documents.minutesMarkdown.split('## 待确认事项')[0];

  assert.match(documents.minutesMarkdown, /客户认可方案方向/);
  assert.match(documents.minutesMarkdown, /待确认事项/);
  assert.doesNotMatch(confirmedFacts, /客户需求与关注点：需要统一数据口径/);
  assert.ok(getMeetingGaps(workspace).required.length > 0);
});

test('only confirmed live records become confirmed meeting facts', () => {
  const workspace = appendLiveRecordFields(createMeetingWorkspace({ meetingType: 'A' }), [
    { label: '客户原话', text: '下周安排业务部门专题交流', status: 'confirmed' },
    { label: '问题/顾虑', text: '预算待确认', status: 'questionable' }
  ]);
  const documents = buildMeetingDocuments(workspace);

  assert.match(documents.minutesMarkdown, /下周安排业务部门专题交流/);
  assert.doesNotMatch(documents.minutesMarkdown.split('## 待确认事项')[0], /预算待确认/);
});
