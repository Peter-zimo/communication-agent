import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMeetingTask } from '../src/taskRouter.js';
import { recommendSopStep } from '../src/taskRouter.js';

test('keeps explicitly selected after-meeting task and B meeting type', () => {
  assert.deepEqual(resolveMeetingTask({
    userInput: '请根据会议纪要告诉我下一步。',
    taskId: 'after_meeting',
    meetingType: 'B'
  }), {
    taskId: 'after_meeting',
    stage: 'after_meeting',
    meetingType: 'B',
    meetingTypeSource: 'explicit',
    needsClarification: false,
    clarificationQuestion: ''
  });
});

test('infers after-meeting and B from minutes about data conditions and pilot scope', () => {
  const result = resolveMeetingTask({
    userInput: '会议纪要：客户的数据分散在多个系统，需要确认数据质量和试点范围。请给出下一步。'
  });

  assert.equal(result.taskId, 'after_meeting');
  assert.equal(result.stage, 'after_meeting');
  assert.equal(result.meetingType, 'B');
  assert.equal(result.meetingTypeSource, 'inferred');
  assert.equal(result.needsClarification, false);
  assert.equal(result.clarificationQuestion, '');
});

test('requests exactly one clarification for an underspecified request', () => {
  const result = resolveMeetingTask({ userInput: '帮我看看怎么处理。' });

  assert.equal(result.needsClarification, true);
  assert.equal(result.taskId, '');
  assert.equal(result.stage, '');
  assert.equal(result.meetingType, '');
  assert.equal(result.clarificationQuestion, '这项内容是用于会前准备、会中追问，还是会后复盘？');
  assert.match(result.clarificationQuestion, /会前|会中|会后/);
});

test('treats a first conversation planned for tomorrow as A even when Demo is mentioned', () => {
  const result = resolveMeetingTask({
    userInput: '明天首次沟通，客户想先看 Demo。'
  });

  assert.equal(result.taskId, 'before_meeting');
  assert.equal(result.stage, 'before_meeting');
  assert.equal(result.meetingType, 'A');
  assert.equal(result.needsClarification, false);
});

test('does not infer B from a single weak data term', () => {
  const result = resolveMeetingTask({ userInput: '数据。' });

  assert.equal(result.taskId, '');
  assert.equal(result.stage, '');
  assert.equal(result.meetingType, '');
  assert.equal(result.needsClarification, true);
});

test('recommends the A before-meeting customer research step from its title', () => {
  const scene = { meetingTypes: [{ id: 'A', sopNodes: [{ id: 'a_customer_research', stage: 'before_meeting', title: '客户基础调研', mustDo: ['确认客户基础信息'] }] }] };
  const result = recommendSopStep(scene, '请告诉我客户基础调研要提供哪些信息');
  assert.equal(result.meetingType, 'A');
  assert.equal(result.stage, 'before_meeting');
  assert.equal(result.sopNodeId, 'a_customer_research');
});

test('falls back to the inferred type and stage when minutes do not name a step', () => {
  const scene = { meetingTypes: [{ id: 'A', sopNodes: [{ id: 'a_before', stage: 'before_meeting', title: '会前准备' }] }] };
  const result = recommendSopStep(scene, '明天首次沟通客户，需要准备会议。');

  assert.equal(result.meetingType, 'A');
  assert.equal(result.stage, 'before_meeting');
  assert.equal(result.sopNodeId, 'a_before');
  assert.match(result.reason, /请确认/);
});
