import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChatMessages } from '../src/promptBuilder.js';

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
        name: '初步宽泛交流',
        intakeSchema: [
          { id: 'customerName', label: '客户单位名称', required: true },
          { id: 'mainBusiness', label: '主营业务', required: true }
        ],
        sopNodes: [
          {
            id: 'a_customer_research',
            step: 1,
            stage: 'before_meeting',
            title: '客户基础调研',
            focus: 'A类只做客户基础调研。',
            mustDo: ['A类调研已有系统'],
            suggested: ['A类准备公司能力材料'],
            experienceTips: ['A类不要过早需求分析'],
            commonMistakes: ['A类把调研当事实'],
            outputs: ['A类兴趣方向']
          }
        ]
      },
      {
        id: 'B',
        name: '意向方向深入交流',
        intakeSchema: [
          { id: 'departmentOrScenario', label: '对接科室或业务场景', required: true },
          { id: 'decisionOwner', label: '决策者或负责人', required: true },
          { id: 'budgetIntent', label: '预算或采购意愿', required: true }
        ],
        sopNodes: [
          {
            id: 'b_business_problem',
            step: 2,
            stage: 'during_meeting',
            title: '业务场景假设与真实问题拆解',
            focus: 'B类拆解业务场景、角色、数据和已有系统。',
            mustDo: ['B类追问数据条件'],
            suggested: ['B类确认成功标准'],
            experienceTips: ['B类功能点不等于需求'],
            commonMistakes: ['B类直接承诺POC'],
            outputs: ['B类信息缺口']
          },
          {
            id: 'b_after_meeting_gaps',
            step: 6,
            stage: 'after_meeting',
            title: '会后信息缺口与下一步判断',
            focus: 'B类会后判断是否进入POC或方案深化。',
            mustDo: ['整理真实问题和数据条件', '明确客户侧行动项和我方行动项'],
            outputs: ['B类下一步判断']
          }
        ]
      },
      {
        id: 'C',
        name: '方案汇报推进交流',
        intakeSchema: [
          { id: 'reportGoal', label: '汇报目标', required: true },
          { id: 'demoTopic', label: 'Demo / 方案主题', required: true }
        ],
        sopNodes: [
          {
            id: 'c_demo_solution_readiness',
            step: 2,
            stage: 'before_meeting',
            title: 'Demo/方案准备状态检查',
            focus: 'C类检查Demo方案和汇报边界。',
            mustDo: ['C类检查演示材料'],
            suggested: ['C类准备风险回应'],
            experienceTips: ['C类不要夸大POC结果'],
            commonMistakes: ['C类没有下一步指示'],
            outputs: ['C类决策事项']
          }
        ]
      }
    ],
    globalGuardrails: ['不编造客户背景。', '不承诺价格周期。']
  },
  playbooks: {
    A: { stages: [{ id: 'before_meeting', name: '会前重点', sections: [{ title: '必做项', items: ['A类准备公司介绍'] }] }] },
    B: {
      stages: [
        { id: 'during_meeting', name: '会中打法', sections: [{ title: '建议追问', items: ['B类追问业务流程'] }] },
        { id: 'after_meeting', name: '会后打法', sections: [{ title: '必做项', items: ['B类判断POC条件'] }] }
      ]
    },
    C: { stages: [{ id: 'before_meeting', name: '会前重点', sections: [{ title: '必做项', items: ['C类准备Demo方案'] }] }] }
  },
  templates: {
    before_meeting: ['# 输出格式参考：客户交流会议 / 交流前准备', '', '## 1. 本次交流定位', '', '## 2. 本次交流目标'].join('\n'),
    during_meeting: ['# 输出格式参考：客户交流会议 / 交流中追问', '', '## 1. 真实问题判断', '', '## 2. 建议追问', '', '## 3. 回应框架'].join('\n'),
    after_meeting: ['# 输出格式参考：客户交流会议 / 交流后复盘', '', '## 1. 对内复盘', '', '### 1.1 本次交流结论', '', '### 1.2 客户关键信息', '', '## 2. 对外跟进', '', '### 2.1 客户侧行动项', '', '### 2.2 我方行动项'].join('\n')
  }
};

test('buildChatMessages rejects missing meeting type', () => {
  assert.throws(() => buildChatMessages(content, { userInput: '怎么准备？' }), /必须先选择交流类型/);
});

test('buildChatMessages rejects empty user input', () => {
  assert.throws(() => buildChatMessages(content, { meetingType: 'A', userInput: '   ' }), /用户输入为空/);
});

test('buildChatMessages injects only the selected meeting type SOP', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'A',
    sopNodeId: 'a_customer_research',
    customerContext: { customerName: '测试客户', mainBusiness: '待补充' },
    userInput: '怎么准备？'
  });
  const text = messages[1].content;

  assert.match(text, /【当前交流性质】A 初步宽泛交流/);
  assert.match(text, /A类只做客户基础调研/);
  assert.match(text, /A类准备公司介绍/);
  assert.doesNotMatch(text, /B类拆解业务场景/);
  assert.doesNotMatch(text, /C类检查Demo方案/);
  assert.match(text, /不得引用、回退或混用其他会议类型 SOP/);
});

test('buildChatMessages uses SOP node stage over stale task id', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'B',
    taskId: 'before_meeting',
    sopNodeId: 'b_business_problem',
    userInput: '客户想做知识库，怎么追问？'
  });
  const text = messages[1].content;

  assert.match(text, /【当前阶段】交流中追问/);
  assert.match(text, /## 1\. 真实问题判断/);
  assert.doesNotMatch(text, /## 1\. 本次交流定位/);
});

test('buildChatMessages includes missing customer context fields', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'C',
    sopNodeId: 'c_demo_solution_readiness',
    customerContext: {},
    userInput: '汇报前检查什么？'
  });
  const text = messages[1].content;

  assert.match(text, /【客户信息缺失项】/);
  assert.match(text, /汇报目标/);
  assert.match(text, /Demo \/ 方案主题/);
});

test('buildChatMessages includes detail node, recommended question, and conversation history', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'A',
    sopNodeId: 'a_customer_research',
    currentDetailNodeId: 'suggested',
    selectedRecommendedQuestion: '请帮我列出会前必须补充的客户背景信息。',
    conversationHistory: [
      { role: 'user', content: '客户有本地部署要求。' },
      { role: 'assistant', content: '需要确认安全边界。' }
    ],
    userInput: '请继续细化。'
  });
  const text = messages[1].content;

  assert.match(text, /【当前详情节点】/);
  assert.match(text, /A类准备公司能力材料/);
  assert.match(text, /【当前推荐问题】请帮我列出会前必须补充的客户背景信息。/);
  assert.match(text, /【最近对话】/);
  assert.match(text, /客户有本地部署要求/);
});

test('buildChatMessages treats stage template as strict output structure requirements', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'B',
    sopNodeId: 'b_business_problem',
    userInput: '客户想做知识库，怎么追问？'
  });
  const text = messages[1].content;

  assert.match(text, /【输出结构要求】/);
  assert.match(text, /必须优先使用当前阶段模板中的标题结构/);
  assert.match(text, /只能使用上面列出的标题/);
  assert.match(text, /只保留与用户问题相关的标题/);
  assert.match(text, /不得输出其他阶段标题/);
  assert.match(text, /## 1\. 真实问题判断/);
  assert.match(text, /## 2\. 建议追问/);
  assert.doesNotMatch(text, /# 输出格式参考/);
});

test('buildChatMessages requires continuous headings and unordered subheading content', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'B',
    sopNodeId: 'b_business_problem',
    userInput: '只输出相关标题和行动项。'
  });
  const text = messages[1].content;

  assert.match(text, /标题编号必须重新连续/);
  assert.match(text, /二级标题下的行动项、选项、下一步动作、风险和建议统一使用 - 无序列表/);
  assert.match(text, /不得把标题编号和列表编号混用/);
  assert.match(text, /二级标题下不得输出数字序号/);
  assert.match(text, /不得输出空方括号占位/);
  assert.match(text, /需要表达先后顺序时，用“优先确认”“随后推进”“确认后执行”等文字说明/);
});

test('buildChatMessages injects single-use uploaded document context', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'A',
    taskId: 'before_meeting',
    sopNodeId: 'a_customer_research',
    customerContext: { customerName: '测试客户' },
    attachments: [{ fileName: 'meeting.md', fileType: 'md', text: '客户提到希望先了解知识库和已有系统集成边界。' }],
    userInput: '请结合附件整理会前要追问什么。'
  });
  const text = messages[1].content;

  assert.match(text, /【本次上传文档】/);
  assert.match(text, /文件：meeting\.md（md）/);
  assert.match(text, /客户提到希望先了解知识库和已有系统集成边界/);
  assert.match(text, /上传文档只作为本次回答参考/);
  assert.match(text, /不得把文档内容自动当作已确认客户信息/);
});

