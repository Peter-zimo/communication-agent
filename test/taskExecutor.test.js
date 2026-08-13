import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTaskMessages, validateTaskOutput } from '../src/taskExecutor.js';

const content = {
  skillPrompt: 'SYSTEM SKILL CONTENT',
  scene: {
    sceneName: '客户交流会议',
    tasks: [
      { id: 'before_meeting', name: '交流前准备' },
      { id: 'during_meeting', name: '交流中追问' },
      { id: 'after_meeting', name: '交流后复盘' }
    ],
    meetingTypes: [
      {
        id: 'A',
        name: '首次沟通',
        intakeSchema: [],
        sopNodes: [{
          id: 'a_before',
          stage: 'before_meeting',
          step: 1,
          title: 'A类会前调研',
          focus: 'A-only 会前调研 SOP'
        }]
      },
      {
        id: 'B',
        name: '需求澄清',
        intakeSchema: [],
        sopNodes: [{
          id: 'b_after',
          stage: 'after_meeting',
          step: 6,
          title: 'B类会后信息缺口与下一步判断',
          focus: 'B-only 会后 SOP：判断是否进入 POC 或方案深化。',
          mustDo: ['明确客户侧行动项和我方行动项']
        }]
      },
      {
        id: 'C',
        name: '方案推进',
        intakeSchema: [],
        sopNodes: [{
          id: 'c_before',
          stage: 'before_meeting',
          step: 2,
          title: 'C类 Demo 准备',
          focus: 'C-only Demo 方案 SOP'
        }]
      }
    ]
  },
  playbooks: {
    B: { stages: [{ id: 'after_meeting', sections: [{ title: '行动项', items: ['B类判断 POC 条件'] }] }] }
  },
  templates: {
    before_meeting: '## 1. 本次交流定位\n### 1.1 会前准备',
    during_meeting: '## 1. 真实问题判断\n### 1.1 建议追问',
    after_meeting: [
      '## 1. 对内复盘',
      '### 1.1 本次交流结论',
      '### 1.2 客户关键信息',
      '## 2. 对外跟进',
      '### 2.1 客户侧行动项',
      '### 2.2 我方行动项',
      '### 2.3 下一步推进建议'
    ].join('\n')
  }
};

test('buildTaskMessages injects only the selected B after-meeting SOP', () => {
  const messages = buildTaskMessages(content, {
    userInput: '根据会议纪要给出下一步。',
    task: { taskId: 'after_meeting', stage: 'after_meeting', meetingType: 'B' },
    attachments: [{ fileName: 'minutes.docx', text: '客户需要确认数据质量。' }],
    customerContext: { customerName: '测试客户' },
    conversationHistory: [{ role: 'user', content: '客户希望安排试点。' }]
  });
  const text = messages[1].content;

  assert.match(text, /B-only 会后 SOP/);
  assert.doesNotMatch(text, /A-only 会前调研 SOP/);
  assert.doesNotMatch(text, /C-only Demo 方案 SOP/);
  assert.match(text, /客户侧行动项/);
  assert.match(text, /我方行动项/);
  assert.match(text, /下一步推进建议/);
  assert.match(text, /不得输出其他阶段标题/);
  assert.match(text, /会议结论、已确认事实、信息缺口/);
});

test('buildTaskMessages returns exactly one clarification question when required', () => {
  const messages = buildTaskMessages(content, {
    userInput: '帮我看看怎么处理。',
    task: {
      needsClarification: true,
      clarificationQuestion: '这是会前准备、会中追问，还是会后复盘？'
    }
  });

  assert.deepEqual(messages, [
    { role: 'system', content: 'SYSTEM SKILL CONTENT' },
    { role: 'user', content: '这是会前准备、会中追问，还是会后复盘？' }
  ]);
});

test('validateTaskOutput rejects numbered items under a secondary heading', () => {
  const result = validateTaskOutput([
    '## 1. 对内复盘',
    '### 1.1 本次交流结论',
    '1. 客户确认数据质量仍待评估。',
    '## 2. 对外跟进',
    '### 2.1 客户侧行动项',
    '- 客户补充样例数据。',
    '### 2.2 我方行动项',
    '- 我方评估数据条件。',
    '### 2.3 下一步推进建议',
    '- 下一步确认试点范围。'
  ].join('\n'), 'after_meeting');

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /二级标题下不得使用数字序号/);
});

test('validateTaskOutput rejects other-stage headings and incomplete after-meeting output', () => {
  const result = validateTaskOutput([
    '## 1. 真实问题判断',
    '### 1.1 建议追问',
    '- 客户需要确认数据。'
  ].join('\n'), 'after_meeting');

  assert.equal(result.valid, false);
  assert.match(result.issues.join('\n'), /不属于当前阶段模板/);
  assert.match(result.issues.join('\n'), /行动项/);
  assert.match(result.issues.join('\n'), /下一/);
});
