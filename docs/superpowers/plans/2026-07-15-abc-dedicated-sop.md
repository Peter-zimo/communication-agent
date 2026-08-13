# ABC Dedicated SOP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the customer communication agent from one shared 7-step SOP into a semi-gated A/B/C workflow where each meeting type has its own intake fields, SOP nodes, recommended questions, prompt context, and tests proving outputs cannot fall back to the generic SOP.

**Architecture:** Keep the existing Node.js static app and content-file pattern. Move the workflow source of truth into meeting-type-specific content under `scene_config.json`; update `contentLoader`, `promptBuilder`, and `public/app.js` to resolve the active meeting type before selecting SOP nodes and questions. Preserve global guardrails and existing expert content, but do not feed the old generic SOP into model prompts.

**Tech Stack:** Node.js ESM, built-in `node:test`, vanilla HTML/CSS/JS, JSON/Markdown content files, OpenAI-compatible chat API through the existing server.

---

## File Structure

Modify these files:

- `content/scene_config.json`: primary content package used by the app. Add `meetingTypes[].intakeSchema` and `meetingTypes[].sopNodes`; remove runtime dependence on top-level `sopNodes`.
- `content/scenes/customer_communication/scene_config.json`: mirrored scene package. Keep it structurally identical to `content/scene_config.json`.
- `content/recommended_questions.json`: reorganize questions by meeting type and SOP node.
- `content/scenes/customer_communication/recommended_questions.json`: mirrored recommended questions package.
- `src/contentLoader.js`: continue loading scene content, but expose helper-compatible structures and validate type-specific content exists.
- `src/promptBuilder.js`: resolve SOP, task, detail node, playbook, and recommended question only from the selected A/B/C meeting type.
- `src/server.js`: reject AI requests without `meetingType` for chat routes and pass `customerContext` through unchanged.
- `public/index.html`: add the semi-gated intake dialog elements and context summary slots.
- `public/app.js`: add intake state, type-specific SOP rendering, type-specific questions, and AI request payload changes.
- `public/styles.css`: add minimal first-phase styles for the intake dialog and context summary only. Do not implement the second-phase visual redesign.

Update or add tests:

- `test/contentLoader.test.js`: assert type-specific SOP and intake schemas load.
- `test/promptBuilder.test.js`: assert A/B/C prompts differ and do not include other type flows.
- `test/playbooks.test.js`: keep playbook compatibility checks.
- `test/sopFirstExperience.test.js`: update from generic SOP-first expectations to type-specific SOP expectations.
- `test/interactionRules.test.js`: replace “meeting type tied to step 2” assertions with semi-gated entry assertions.
- `test/inlineSopExperience.test.js`: update static UI expectations for type-specific rendering and current detail panel.
- `test/sopHierarchyUi.test.js`: update UI contract for first-phase intake and no node modal.
- `test/uiContract.test.js`: ensure public assets do not expose planning docs and do expose the workspace entry.

Do not modify these files unless tests show a direct need:

- `src/modelClient.js`
- `content/templates/*.md`
- `content/source/customer_communication_skill.md`
- `content/meeting_playbooks.json`

---

### Task 1: Add Content Tests For Type-Specific SOP

**Files:**
- Modify: `test/contentLoader.test.js`
- Modify: `test/sopFirstExperience.test.js`

- [ ] **Step 1: Update `test/contentLoader.test.js` with type-specific assertions**

Replace the existing two tests with this file content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadContent } from '../src/contentLoader.js';

test('loadContent reads bundled scene configuration and prompt assets', async () => {
  const content = await loadContent();

  assert.equal(content.scene.sceneId, 'customer_communication');
  assert.ok(content.scene.sceneName);
  assert.ok(content.skillPrompt.length > 0);
  assert.ok(content.templates.before_meeting.length > 0);
  assert.ok(content.questions.byMeetingType.A.bySopNode.a_customer_research.length > 0);
});

test('loadContent exposes A/B/C intake schemas and dedicated SOP nodes', async () => {
  const content = await loadContent('customer_communication');
  const byType = Object.fromEntries(content.scene.meetingTypes.map((type) => [type.id, type]));

  assert.deepEqual(Object.keys(byType), ['A', 'B', 'C']);
  assert.ok(byType.A.intakeSchema.some((field) => field.id === 'customerName'));
  assert.ok(byType.B.intakeSchema.some((field) => field.id === 'knownInterest'));
  assert.ok(byType.C.intakeSchema.some((field) => field.id === 'demoReadiness'));

  assert.deepEqual(
    byType.A.sopNodes.map((node) => node.id),
    ['a_customer_research', 'a_background_and_roles', 'a_material_preparation', 'a_meeting_guidance', 'a_after_meeting_interest']
  );
  assert.deepEqual(
    byType.B.sopNodes.map((node) => node.id),
    ['b_interest_confirmation', 'b_business_problem', 'b_roles_and_decision_chain', 'b_data_systems_competitors', 'b_poc_or_solution_judgement', 'b_after_meeting_gaps']
  );
  assert.deepEqual(
    byType.C.sopNodes.map((node) => node.id),
    ['c_report_goal_and_decision', 'c_demo_solution_readiness', 'c_value_boundary_risk', 'c_feedback_collection', 'c_trial_poc_project_judgement', 'c_after_meeting_actions']
  );

  assert.equal(content.sourceDir.endsWith('content\\scenes\\customer_communication') || content.sourceDir.endsWith('content/scenes/customer_communication'), true);
});
```

- [ ] **Step 2: Update `test/sopFirstExperience.test.js` with dedicated SOP expectations**

Replace the first two tests with:

```js
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
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```powershell
node --test test/contentLoader.test.js test/sopFirstExperience.test.js
```

Expected: FAIL because `byMeetingType`, `intakeSchema`, dedicated node IDs, and missing-type prompt rejection are not implemented yet.

---

### Task 2: Restructure Scene Content And Recommended Questions

**Files:**
- Modify: `content/scene_config.json`
- Modify: `content/scenes/customer_communication/scene_config.json`
- Modify: `content/recommended_questions.json`
- Modify: `content/scenes/customer_communication/recommended_questions.json`
- Test: `test/contentLoader.test.js`
- Test: `test/sopFirstExperience.test.js`

- [ ] **Step 1: Rewrite `content/scene_config.json` to include type-specific content**

Use the existing top-level metadata, `purpose`, `audience`, `globalGuardrails`, and `interaction.playbookStageNames`. Replace top-level runtime `sopNodes` with `meetingTypes[].intakeSchema` and `meetingTypes[].sopNodes`.

Each meeting type must include the exact node IDs asserted in Task 1:

```json
{
  "id": "A",
  "name": "初步宽泛交流",
  "intakeSchema": [
    { "id": "customerName", "label": "客户单位名称", "required": true, "allowUnknown": true },
    { "id": "mainBusiness", "label": "主营业务", "required": true, "allowUnknown": true },
    { "id": "industry", "label": "所属领域", "required": true, "allowUnknown": true },
    { "id": "meetingReason", "label": "本次交流发起原因", "required": false, "allowUnknown": true },
    { "id": "participants", "label": "参会对象", "required": false, "allowUnknown": true },
    { "id": "history", "label": "已知历史接触情况", "required": false, "allowUnknown": true }
  ],
  "sopNodes": [
    {
      "id": "a_customer_research",
      "step": 1,
      "title": "客户基础调研",
      "summary": "先建立客户背景认知，准备已有系统、同类软件和维泰差分点。",
      "focus": "本阶段只做信息调研，不要过早设计解决方案。",
      "mustDo": ["了解客户主营业务、组织背景、近期重点工作。", "确认历史接触、历史材料和相似客户资料。", "调研客户体系内已有或拟建设的软件、系统、友商产品、客户评价和费用线索。", "调研同类型软件或系统在行业里的头部产品、国内技术情况和常见卖点。"],
      "suggested": ["准备 2 到 3 个可能相关方向，但不要包装成确定方案。", "对调研结论标注基于公开信息或内部材料，需要现场校准。"],
      "experienceTips": ["横向准备包括客户体系内已有或拟建设的软件系统，以及行业同类型软件和国内技术情况。", "竞品或同类产品信息用于内部准备差分点，不能现场贬低友商。"],
      "commonMistakes": ["只查客户官网，不问内部同事。", "看到同一行业就默认可以套用之前案例。", "把会前调研输出当成事实，不做边界说明。"],
      "aiCanHelp": ["请帮我快速了解这个客户可能的业务领域和数字化关注点。", "请列出会前必须补充的客户背景信息。"],
      "outputs": ["客户背景摘要", "已有系统/友商/预算线索", "同类软件与差分点准备清单", "会前待核实问题"],
      "guardrails": ["不编造客户背景。", "不贬低友商。", "不把调研判断当成客户事实。"]
    }
  ]
}
```

After adding the first node exactly as above, complete A/B/C with the node IDs and topics from `docs/需求更正设计方案.md`. Move detailed items from the old top-level `sopNodes` and `meeting_playbooks.json`; do not invent new expert claims. Each node must contain at least `id`, `step`, `title`, `summary`, `focus`, `mustDo`, `suggested`, `experienceTips`, `commonMistakes`, `aiCanHelp`, `outputs`, and `guardrails`.

- [ ] **Step 2: Mirror the same scene config into the scene package**

Copy the final `content/scene_config.json` content to `content/scenes/customer_communication/scene_config.json`.

Use PowerShell copy after reviewing the source path:

```powershell
Copy-Item -LiteralPath content\scene_config.json -Destination content\scenes\customer_communication\scene_config.json
```

- [ ] **Step 3: Rewrite recommended questions by meeting type**

Set `content/recommended_questions.json` to this shape, filling every node ID from Task 1:

```json
{
  "sceneId": "customer_communication",
  "byMeetingType": {
    "A": {
      "globalQuestions": ["请根据我提供的信息，判断这次初步宽泛交流还缺哪些会前准备。"],
      "bySopNode": {
        "a_customer_research": ["请帮我快速了解这个客户可能的业务领域和数字化关注点。", "请列出会前必须补充的客户背景信息。", "请帮我整理客户已有系统、同类软件和维泰差分点准备清单。"],
        "a_background_and_roles": ["请帮我判断本次初次交流的参会对象关注点。", "请生成本次交流的会前目标卡。"],
        "a_material_preparation": ["请根据客户背景生成材料准备清单。", "请判断哪些材料适合主讲，哪些只适合作为备选。"],
        "a_meeting_guidance": ["客户只是宽泛了解，我应该如何引导兴趣方向？", "请生成不会过早承诺的现场回应框架。"],
        "a_after_meeting_interest": ["请根据交流记录判断客户最有反应的方向。", "请建议下一次交流主题和跟进科室。"]
      }
    },
    "B": {
      "globalQuestions": ["请根据我提供的信息，判断这个兴趣方向是否已经具备深入澄清条件。"],
      "bySopNode": {
        "b_interest_confirmation": ["请帮我确认客户已知兴趣方向还缺哪些背景。", "请把上次共识整理成本次深入交流开场。"],
        "b_business_problem": ["客户这个功能点背后的真实业务问题可能是什么？", "请帮我拆解业务流程、岗位、场景和痛点。", "请生成 3 个继续追问真实问题的问题。"],
        "b_roles_and_decision_chain": ["请帮我识别真正使用者、评价人和决策影响人。", "请提醒不同角色可能关注什么。"],
        "b_data_systems_competitors": ["请帮我追问数据来源、数据形态和权限边界。", "请整理已有系统、友商方案和客户评价需要确认的问题。"],
        "b_poc_or_solution_judgement": ["请判断当前是否适合进入 POC 规划。", "请列出进入方案深化前必须补齐的信息。"],
        "b_after_meeting_gaps": ["请根据纪要生成信息缺口和下一步分流建议。", "请判断应该需求澄清、POC规划、方案交流还是暂缓。"]
      }
    },
    "C": {
      "globalQuestions": ["请根据我提供的信息，判断这次方案汇报最需要推动客户给出什么动作。"],
      "bySopNode": {
        "c_report_goal_and_decision": ["请帮我确认本次汇报目标和决策对象。", "请生成客户会后决策事项清单。"],
        "c_demo_solution_readiness": ["请帮我检查 Demo 或方案材料准备风险。", "请列出试用或演示前必须确认的边界。"],
        "c_value_boundary_risk": ["请帮我梳理方案价值、适用边界和风险回应。", "请提醒本次汇报不能承诺的事项。"],
        "c_feedback_collection": ["客户提出这个质疑，我应该如何回应并收集反馈？", "请帮我整理认可点、质疑点和补充要求。"],
        "c_trial_poc_project_judgement": ["请判断是否适合释放试用、扩大试点或进入立项。", "请列出客户侧需要满足的试用或立项条件。"],
        "c_after_meeting_actions": ["请根据汇报记录生成会后行动清单。", "请判断下一步应该补方案、商务推进、继续技术交流还是暂缓。"]
      }
    }
  }
}
```

- [ ] **Step 4: Mirror recommended questions into the scene package**

```powershell
Copy-Item -LiteralPath content\recommended_questions.json -Destination content\scenes\customer_communication\recommended_questions.json
```

- [ ] **Step 5: Run focused content tests**

Run:

```powershell
node --test test/contentLoader.test.js test/sopFirstExperience.test.js
```

Expected: `contentLoader` assertions pass. `sopFirstExperience` may still fail on `buildChatMessages` missing-type behavior until Task 4.

---

### Task 3: Update Content Loader Compatibility

**Files:**
- Modify: `src/contentLoader.js`
- Test: `test/contentLoader.test.js`
- Test: `test/playbooks.test.js`

- [ ] **Step 1: Add validation helpers to `src/contentLoader.js`**

After reading `scene`, call a local `validateSceneContent(scene, questions)` before returning.

Add this function at the bottom:

```js
function validateSceneContent(scene, questions) {
  const typeIds = new Set((scene.meetingTypes || []).map((type) => type.id));
  for (const required of ['A', 'B', 'C']) {
    if (!typeIds.has(required)) throw new Error(`Missing meeting type: ${required}`);
    const type = scene.meetingTypes.find((item) => item.id === required);
    if (!Array.isArray(type.intakeSchema) || type.intakeSchema.length === 0) {
      throw new Error(`Missing intake schema for meeting type: ${required}`);
    }
    if (!Array.isArray(type.sopNodes) || type.sopNodes.length === 0) {
      throw new Error(`Missing SOP nodes for meeting type: ${required}`);
    }
  }

  if (!questions?.byMeetingType?.A || !questions?.byMeetingType?.B || !questions?.byMeetingType?.C) {
    throw new Error('Missing type-specific recommended questions.');
  }
}
```

In `loadContent`, place:

```js
validateSceneContent(scene, questions);
```

immediately after all files are loaded and before destructuring `reviewTemplate`.

- [ ] **Step 2: Preserve return shape**

Keep returning `scene`, `questions`, `playbooks`, `reviewTemplate`, `skillPrompt`, and `templates`. Do not introduce a new public return object yet; callers will resolve type-specific data from `scene.meetingTypes`.

- [ ] **Step 3: Run loader and playbook tests**

Run:

```powershell
node --test test/contentLoader.test.js test/playbooks.test.js
```

Expected: PASS.

---

### Task 4: Add PromptBuilder Tests For Strict A/B/C Context

**Files:**
- Modify: `test/promptBuilder.test.js`

- [ ] **Step 1: Replace the test fixture with type-specific content**

In `test/promptBuilder.test.js`, replace the `content` fixture with:

```js
const content = {
  skillPrompt: 'SYSTEM SKILL CONTENT',
  scene: {
    sceneName: '客户交流会议',
    meetingTypes: [
      {
        id: 'A',
        name: '初步宽泛交流',
        intakeSchema: [{ id: 'customerName', label: '客户单位名称', required: true, allowUnknown: true }],
        sopNodes: [{ id: 'a_customer_research', step: 1, title: '客户基础调研', focus: 'A类只做客户基础调研。', mustDo: ['A类调研已有系统'], suggested: ['A类准备公司能力材料'], experienceTips: ['A类不要过早需求分析'], commonMistakes: ['A类把调研当事实'], outputs: ['A类兴趣方向'] }]
      },
      {
        id: 'B',
        name: '意向方向深入交流',
        intakeSchema: [{ id: 'knownInterest', label: '客户关注方向', required: true, allowUnknown: true }],
        sopNodes: [{ id: 'b_business_problem', step: 2, title: '业务场景与真实问题拆解', focus: 'B类拆解业务场景、角色、数据、已有系统。', mustDo: ['B类追问数据条件'], suggested: ['B类确认成功标准'], experienceTips: ['B类功能点不等于需求'], commonMistakes: ['B类直接承诺POC'], outputs: ['B类信息缺口'] }]
      },
      {
        id: 'C',
        name: '方案汇报推进交流',
        intakeSchema: [{ id: 'demoReadiness', label: 'Demo 或方案准备情况', required: true, allowUnknown: true }],
        sopNodes: [{ id: 'c_demo_solution_readiness', step: 2, title: 'Demo/方案准备状态检查', focus: 'C类检查Demo方案和汇报边界。', mustDo: ['C类检查演示材料'], suggested: ['C类准备风险回应'], experienceTips: ['C类不要夸大POC结果'], commonMistakes: ['C类没有要下一步指示'], outputs: ['C类决策事项'] }]
      }
    ],
    globalGuardrails: ['不编造客户背景。', '不承诺价格周期。']
  },
  playbooks: {
    A: { stages: [{ id: 'before_meeting', name: '会前重点', sections: [{ title: '必做项', items: ['A类准备公司介绍'] }] }] },
    B: { stages: [{ id: 'during_meeting', name: '会中打法', sections: [{ title: '建议追问', items: ['B类追问业务流程'] }] }] },
    C: { stages: [{ id: 'before_meeting', name: '会前重点', sections: [{ title: '必做项', items: ['C类准备Demo方案'] }] }] }
  },
  templates: {
    before_meeting: 'BEFORE TEMPLATE',
    during_meeting: 'DURING TEMPLATE',
    after_meeting: 'AFTER TEMPLATE'
  }
};
```

- [ ] **Step 2: Add strict prompt tests**

Add these tests after the fixture:

```js
test('buildChatMessages rejects missing meeting type', () => {
  assert.throws(
    () => buildChatMessages(content, { userInput: '怎么准备？' }),
    /必须先选择交流类型/
  );
});

test('buildChatMessages injects only A class SOP for A class', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'A',
    taskId: 'before_meeting',
    sopNodeId: 'a_customer_research',
    customerContext: { customerName: '某能源客户', mainBusiness: '待补充' },
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

test('buildChatMessages injects only B class SOP for B class', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'B',
    taskId: 'during_meeting',
    sopNodeId: 'b_business_problem',
    customerContext: { knownInterest: '智能知识库' },
    userInput: '客户想做知识库，怎么追问？'
  });

  const text = messages[1].content;
  assert.match(text, /【当前交流性质】B 意向方向深入交流/);
  assert.match(text, /B类拆解业务场景、角色、数据、已有系统/);
  assert.match(text, /B类追问业务流程/);
  assert.doesNotMatch(text, /A类只做客户基础调研/);
  assert.doesNotMatch(text, /C类检查Demo方案/);
});

test('buildChatMessages injects only C class SOP for C class', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'C',
    taskId: 'before_meeting',
    sopNodeId: 'c_demo_solution_readiness',
    customerContext: { demoReadiness: '已有Demo，待脱敏确认' },
    userInput: '汇报前检查什么？'
  });

  const text = messages[1].content;
  assert.match(text, /【当前交流性质】C 方案汇报推进交流/);
  assert.match(text, /C类检查Demo方案和汇报边界/);
  assert.match(text, /C类准备Demo方案/);
  assert.doesNotMatch(text, /A类只做客户基础调研/);
  assert.doesNotMatch(text, /B类拆解业务场景/);
});

test('buildChatMessages includes missing customer context fields', () => {
  const messages = buildChatMessages(content, {
    meetingType: 'C',
    sopNodeId: 'c_demo_solution_readiness',
    customerContext: {},
    userInput: '汇报前检查什么？'
  });

  assert.match(messages[1].content, /【客户信息缺失项】/);
  assert.match(messages[1].content, /Demo 或方案准备情况/);
});
```

- [ ] **Step 3: Remove or update old tests that assert unknown meeting type becomes unjudged**

Delete the old test named `buildChatMessages uses free question output rules and marks unknown meeting type as unjudged`. Missing or unknown meeting type must now throw.

- [ ] **Step 4: Run prompt tests and verify failure**

Run:

```powershell
node --test test/promptBuilder.test.js
```

Expected: FAIL until Task 5 implements strict type resolution.

---

### Task 5: Implement Strict Type-Specific Prompt Builder

**Files:**
- Modify: `src/promptBuilder.js`
- Test: `test/promptBuilder.test.js`
- Test: `test/sopFirstExperience.test.js`

- [ ] **Step 1: Add type resolution helpers**

In `src/promptBuilder.js`, add these helpers near existing resolver functions:

```js
function resolveMeetingTypeObject(scene, meetingTypeId) {
  const normalized = String(meetingTypeId || '').toUpperCase();
  const match = scene.meetingTypes.find((item) => item.id === normalized);
  if (!match) {
    const error = new Error('必须先选择交流类型 A/B/C。');
    error.code = 'MISSING_MEETING_TYPE';
    throw error;
  }
  return match;
}

function resolveTypeSopNode(meetingType, sopNodeId) {
  const nodes = meetingType.sopNodes || [];
  return nodes.find((item) => item.id === sopNodeId) || nodes[0] || null;
}

function formatCustomerContext(meetingType, customerContext = {}) {
  const schema = meetingType.intakeSchema || [];
  const lines = [];
  const missing = [];

  for (const field of schema) {
    const value = String(customerContext[field.id] || '').trim();
    if (value) lines.push(`${field.label}：${value}`);
    else if (field.required) missing.push(field.label);
  }

  return {
    knownText: lines.length ? lines.join('\n') : '暂无已填写客户信息。',
    missingText: missing.length ? missing.map((item) => `- ${item}`).join('\n') : '无。'
  };
}

function formatTypeSopSummary(meetingType) {
  return (meetingType.sopNodes || [])
    .map((node) => `STEP ${String(node.step).padStart(2, '0')} ${node.title}：${node.summary || node.focus || ''}`)
    .join('\n');
}
```

- [ ] **Step 2: Change `buildChatMessages` to resolve selected type first**

At the top of `buildChatMessages`, after user input validation, replace old node and meeting type resolution with:

```js
const meetingType = resolveMeetingTypeObject(content.scene, request.meetingType);
const meetingTypeId = meetingType.id;
const node = resolveTypeSopNode(meetingType, request.sopNodeId);
const taskId = resolveTaskIdFromNode(node, request.taskId);
const stageName = resolveStageName(content.scene, taskId);
const detailNode = resolveDetailNode(node, request.currentDetailNodeId, content.reviewTemplate);
const playbookStage = resolvePlaybookStage(content.playbooks, meetingTypeId, taskId);
const customerContext = formatCustomerContext(meetingType, request.customerContext);
```

Remove the old call to `resolveMeetingType(content.scene, meetingTypeId)` from this path.

- [ ] **Step 3: Pass type-specific context into `buildBackgroundBlocks`**

Update the call to include:

```js
meetingType: `${meetingType.id} ${meetingType.name}`,
meetingTypeObject: meetingType,
customerContext,
```

- [ ] **Step 4: Update `buildBackgroundBlocks`**

Add these blocks after current scene/type/stage:

```js
blocks.push(`【客户信息】\n${ctx.customerContext.knownText}`);
blocks.push(`【客户信息缺失项】\n${ctx.customerContext.missingText}`);
blocks.push(`【当前类型专属SOP】\n${formatTypeSopSummary(ctx.meetingTypeObject)}`);
```

Keep current node, detail node, playbook, selected question, history, FAQ, and POC blocks, but ensure they use the selected `meetingTypeId` only.

- [ ] **Step 5: Replace answer instruction text with strict type rule**

In the user message content, replace the existing answer instruction paragraph with:

```js
'请直接回答用户问题，给出有针对性的核心答案。下面的"背景参考"只是当前会议类型的知识库。你只能依据当前会议类型的专属 SOP 输出建议，不得引用、回退或混用其他会议类型 SOP，不得默认按 A 类宽泛交流处理。信息不足时列出需补充信息，不得编造客户背景、预算、友商评价或项目事实。涉及公司产品能力、案例适配性、POC 可行性、部署形态时，未经依据一律标注"需内部确认"。如果用户问题明显属于其他会议类型，应建议用户切换会议类型，而不是混用流程。'
```

- [ ] **Step 6: Keep `resolveMeetingType` only if still used, otherwise delete it**

If no call sites remain, remove the old `resolveMeetingType` function to avoid confusion.

- [ ] **Step 7: Run focused prompt tests**

Run:

```powershell
node --test test/promptBuilder.test.js test/sopFirstExperience.test.js
```

Expected: PASS.

---

### Task 6: Enforce Meeting Type In Server Chat Routes

**Files:**
- Modify: `src/server.js`
- Modify: `src/modelClient.js` only if error mapping needs a new code
- Test: existing server tests in `test/modelConfig.test.js` or add small assertion to existing server test file if present

- [ ] **Step 1: Add request validation helper in `src/server.js`**

Add near `readJsonBody`:

```js
function validateChatRequest(body) {
  const meetingType = String(body.meetingType || '').toUpperCase();
  if (!['A', 'B', 'C'].includes(meetingType)) {
    const error = new Error('必须先选择交流类型 A/B/C。');
    error.code = 'MISSING_MEETING_TYPE';
    throw error;
  }
}
```

- [ ] **Step 2: Call validation before `buildChatMessages`**

In both `chat` and `chat-stream` branches, after reading `body`, add:

```js
validateChatRequest(body);
```

- [ ] **Step 3: Map validation error to 400**

In the main catch block, before calling `mapModelError`, add:

```js
if (error.code === 'MISSING_MEETING_TYPE') {
  return sendJson(response, 400, { errorType: 'missing_meeting_type', errorMessage: error.message });
}
```

- [ ] **Step 4: Run syntax check and existing server-related tests**

Run:

```powershell
node --check src/server.js
node --test test/modelConfig.test.js
```

Expected: PASS.

---

### Task 7: Add Frontend Intake UI Tests

**Files:**
- Modify: `test/interactionRules.test.js`
- Modify: `test/inlineSopExperience.test.js`
- Modify: `test/sopHierarchyUi.test.js`

- [ ] **Step 1: Replace old step-2 classification test**

In `test/interactionRules.test.js`, replace the test `meeting type controls are tied to the second SOP step and not a scene entry gate` with:

```js
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
});
```

- [ ] **Step 2: Update AI chat context test**

In `test/interactionRules.test.js`, replace `AI chat sends SOP-first context without customer form dependencies` with:

```js
test('AI chat sends meeting type and customer context', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /meetingType: state\.meetingType/);
  assert.match(app, /customerContext: state\.customerContext/);
  assert.match(app, /sopNodeId: state\.sopNodeId/);
  assert.match(app, /selectedRecommendedQuestion: state\.selectedRecommendedQuestion/);
  assert.match(app, /const conversationHistory = recentConversationHistory\(\)/);
});
```

- [ ] **Step 3: Update static UI tests to expect no playbook cards inside node detail**

In `test/inlineSopExperience.test.js`, replace the test `meeting type judgement restores ABC cards with before during after playbooks` with:

```js
test('workbench renders only the selected meeting type SOP', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /function currentSopNodes\(\)/);
  assert.match(app, /currentMeetingTypeConfig\(\)\?\.sopNodes/);
  assert.match(app, /state\.scene\.meetingTypes/);
  assert.doesNotMatch(app, /renderMeetingTypePlaybooks/);
  assert.doesNotMatch(app, /classificationNodeId/);
});
```

- [ ] **Step 4: Update hierarchy UI contract**

In `test/sopHierarchyUi.test.js`, change assertions:

```js
assert.match(html, /id="intakeDialog"/);
assert.match(app, /renderIntakeDialog/);
assert.match(app, /renderCurrentNodeDetail/);
assert.match(app, /renderDetailAccordion/);
assert.doesNotMatch(app, /renderMeetingTypePlaybooks/);
```

- [ ] **Step 5: Run UI tests and verify failure**

Run:

```powershell
node --test test/interactionRules.test.js test/inlineSopExperience.test.js test/sopHierarchyUi.test.js
```

Expected: FAIL until Task 8 implements frontend intake and type-specific rendering.

---

### Task 8: Implement Frontend Semi-Gated Intake And Type-Specific SOP Rendering

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: UI tests from Task 7

- [ ] **Step 1: Add intake dialog HTML**

In `public/index.html`, inside `#sceneView` before the final `questionMoreDialog`, add:

```html
<dialog class="intake-dialog" id="intakeDialog">
  <article class="intake-card">
    <div class="dialog-head">
      <h2>选择客户交流类型</h2>
    </div>
    <p class="intake-copy">必须先选择 A/B/C 类型；客户信息不清楚时可先标记待补充。</p>
    <div class="intake-type-grid" id="intakeMeetingTypes"></div>
    <div class="intake-fields" id="intakeFields"></div>
    <div class="dialog-actions">
      <button type="button" id="submitIntake">进入工作台</button>
    </div>
  </article>
</dialog>
```

- [ ] **Step 2: Add elements and state in `public/app.js`**

Update `state`:

```js
meetingType: '',
customerContext: {},
intakeCompleted: false,
sopNodeId: null,
```

Add `els`:

```js
intakeDialog: document.querySelector('#intakeDialog'),
intakeMeetingTypes: document.querySelector('#intakeMeetingTypes'),
intakeFields: document.querySelector('#intakeFields'),
submitIntake: document.querySelector('#submitIntake'),
```

- [ ] **Step 3: Initialize first SOP only after type selection**

In `init`, remove default `state.sopNodeId = state.scene.sopNodes[0]?.id || null;`. After config load, call `renderIntakeDialog(); showModal(els.intakeDialog);` when entering the scene for the first time.

For scene card click, set `state.view = 'customer_communication'`, render, then show the intake dialog if `!state.intakeCompleted`.

- [ ] **Step 4: Add intake functions**

Add:

```js
function currentMeetingTypeConfig() {
  return state.scene?.meetingTypes?.find((type) => type.id === state.meetingType) || null;
}

function currentSopNodes() {
  return currentMeetingTypeConfig()?.sopNodes || [];
}

function renderIntakeDialog() {
  els.intakeMeetingTypes.replaceChildren(...state.scene.meetingTypes.map((type) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `intake-type${state.meetingType === type.id ? ' active' : ''}`;
    button.textContent = `${type.id} 类 ${type.name}`;
    button.addEventListener('click', () => {
      state.meetingType = type.id;
      state.customerContext = {};
      renderIntakeDialog();
    });
    return button;
  }));
  renderIntakeFields();
}

function renderIntakeFields() {
  const type = currentMeetingTypeConfig();
  if (!type) {
    els.intakeFields.replaceChildren();
    return;
  }
  els.intakeFields.replaceChildren(...type.intakeSchema.map((field) => {
    const label = document.createElement('label');
    label.className = 'intake-field';
    label.innerHTML = `<span>${escapeHtml(field.label)}${field.required ? ' *' : ''}</span>`;
    const input = document.createElement('input');
    input.value = state.customerContext[field.id] || '';
    input.placeholder = '不清楚可留空，AI 会提示待补充';
    input.addEventListener('input', () => { state.customerContext[field.id] = input.value; });
    label.append(input);
    return label;
  }));
}

function submitIntake() {
  const type = currentMeetingTypeConfig();
  if (!type) {
    pushMessage('error', '请先选择 A/B/C 交流类型。');
    return;
  }
  state.intakeCompleted = true;
  state.sopNodeId = type.sopNodes[0]?.id || null;
  els.intakeDialog.close();
  renderAll();
}
```

Bind `els.submitIntake.addEventListener('click', submitIntake);` in `bindEvents`.

- [ ] **Step 5: Render only selected SOP nodes**

Update `renderSopList`, `currentNode`, and any loops from `state.scene.sopNodes` to `currentSopNodes()`.

Example:

```js
function renderSopList() {
  const nodes = currentSopNodes();
  els.sopList.replaceChildren(...nodes.map((node) => {
    const wrap = document.createElement('section');
    wrap.className = `sop-node-wrap${node.id === state.sopNodeId ? ' active' : ''}`;
    wrap.innerHTML = renderSopNodeButton(node);
    wrap.querySelector('.sop-step').addEventListener('click', () => selectSopNode(node.id));
    return wrap;
  }));
}
```

- [ ] **Step 6: Remove step-2 classification flow**

Remove or stop using: `classificationNodeId`, `classificationRequiredBeforeStep`, `shouldWarnBeforeNode`, `renderMeetingTypePlaybooks`, `selectMeetingType`, `goMeetingTypeStep`, `continueViewNode`, `stepWarningModal` bindings. The old `stepWarningModal` HTML can remain for a later cleanup only if no tests assert it is absent, but no code should depend on it.

- [ ] **Step 7: Update question lookup**

Change `questionsForCurrentNode` to read:

```js
const typeQuestions = state.questions?.byMeetingType?.[state.meetingType] || {};
const nodeQuestions = [...((typeQuestions.bySopNode || {})[nodeId] || [])];
const globalQuestions = [...(typeQuestions.globalQuestions || [])];
const unique = [...new Set([...nodeQuestions, ...globalQuestions])].filter(Boolean);
```

Remove `byTask` fallback for first phase to prevent cross-type question reuse.

- [ ] **Step 8: Include customer context in AI request**

In `sendMessage`, before sending, reject missing type:

```js
if (!state.meetingType) {
  pushMessage('error', '请先选择 A/B/C 交流类型。');
  return;
}
```

Add to request body:

```js
customerContext: state.customerContext,
```

- [ ] **Step 9: Add minimal CSS**

In `public/styles.css`, add:

```css
.intake-dialog::backdrop { background: rgba(18, 24, 38, 0.38); }
.intake-card { width: min(760px, calc(100vw - 32px)); background: #fff; color: #111827; border-radius: 8px; padding: 24px; }
.intake-copy { margin: 8px 0 18px; color: #4b5563; }
.intake-type-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
.intake-type { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 8px; padding: 12px; text-align: left; cursor: pointer; }
.intake-type.active { border-color: var(--accent); background: #e6f4f1; }
.intake-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.intake-field { display: grid; gap: 6px; font-size: 14px; }
.intake-field input { min-height: 38px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
@media (max-width: 720px) { .intake-type-grid, .intake-fields { grid-template-columns: 1fr; } }
```

- [ ] **Step 10: Run UI tests**

Run:

```powershell
node --test test/interactionRules.test.js test/inlineSopExperience.test.js test/sopHierarchyUi.test.js
```

Expected: PASS.

---

### Task 9: Update Remaining Tests And Run Full Suite

**Files:**
- Modify: `test/uiContract.test.js` if needed
- Modify: `test/playbooks.test.js` if needed
- Modify: any test still asserting old step-2 classification

- [ ] **Step 1: Search for old generic SOP assumptions**

Run:

```powershell
rg "classificationNodeId|renderMeetingTypePlaybooks|meeting_type_judgement|scene\.sopNodes|bySopNode|globalQuestions|交流性质未判断" test public src content
```

Expected: remaining matches should either be in historical docs or intentionally updated compatibility paths. Runtime tests should not require `meeting_type_judgement` or top-level `scene.sopNodes`.

- [ ] **Step 2: Update `test/playbooks.test.js` only if broken**

If `playbooks.test.js` fails because the review template or playbooks return shape changed, keep this assertion shape:

```js
assert.equal(content.playbooks.A.name, '初步宽泛交流');
assert.equal(content.playbooks.B.name, '意向方向深入交流');
assert.equal(content.playbooks.C.name, '方案汇报推进交流');
assert.ok(content.reviewTemplate.items.includes('客户关键原话'));
```

Do not remove playbook coverage; promptBuilder still uses type-specific playbook stages.

- [ ] **Step 3: Run full test suite**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run server syntax check**

Run:

```powershell
node --check src/server.js
node --check src/promptBuilder.js
node --check src/contentLoader.js
```

Expected: no syntax errors.

---

### Task 10: Manual Verification

**Files:**
- No code changes unless a verification bug is found

- [ ] **Step 1: Start the local server**

Run:

```powershell
node src/server.js
```

Expected: server prints `Customer communication agent running at http://localhost:5173`.

- [ ] **Step 2: Verify entry gating in browser**

Open `http://localhost:5173` and enter “客户交流会议”.

Expected:

- Intake dialog appears.
- A/B/C must be selected before entering workbench.
- Empty customer fields are allowed.
- Selected type controls visible SOP nodes.

- [ ] **Step 3: Verify A/B/C SOP differences**

Select each type and confirm node titles:

- A starts with `客户基础调研`.
- B starts with `已知兴趣方向确认`.
- C starts with `汇报目标与决策对象确认`.

- [ ] **Step 4: Verify prompt behavior through UI**

For each A/B/C type, ask the same question: `这次客户交流我应该重点准备什么？`

Expected:

- A mentions first-meeting/background/research/company capability preparation.
- B mentions business scenario/role/data/existing systems/POC readiness.
- C mentions demo/solution/reporting goal/value/risk/customer decision.

- [ ] **Step 5: Stop the server**

Terminate the server process with `Ctrl+C`.

---

## Self-Review

- Spec coverage: The plan covers semi-gated intake, A/B/C dedicated SOP content, type-specific recommended questions, prompt context isolation, frontend type-specific rendering, missing field reminders, and tests for A/B/C differences.
- Scope control: Visual redesign, checklist locking, model settings, and Excel export are explicitly out of first-phase scope.
- Type consistency: The canonical node IDs are defined in Task 1 and reused in content, questions, prompt tests, and UI tasks.
- Test strategy: Failing tests are introduced before implementation tasks, using the existing `node:test` style and focused commands.
