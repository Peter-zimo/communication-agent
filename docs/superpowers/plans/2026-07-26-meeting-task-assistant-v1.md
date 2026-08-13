# Meeting Task Assistant V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the customer communication workspace into a natural-language meeting task assistant that handles meeting preparation, in-meeting follow-up, and after-meeting review/next-step guidance, with Word export.

**Architecture:** Add a server-side task router that resolves an explicit task or conservatively infers one from the user's content. The task executor selects one A/B/C SOP and one meeting stage, builds a constrained prompt, then streams the private-network model response. A local DOCX generator converts the validated Markdown result into a downloadable Word file. The existing SOP content remains the single source of business rules.

**Tech Stack:** Node.js native HTTP server, vanilla HTML/CSS/JavaScript, Node test runner, `mammoth` for DOCX input, `docx` for local DOCX output, internal OpenAI-compatible `ziwigpt-kinetic` service.

---

## File map

- Create `src/taskRouter.js`: task/stage/type inference and explicit override normalization.
- Create `src/taskExecutor.js`: builds the selected SOP context and task-specific prompt messages.
- Create `src/docxExporter.js`: turns validated Markdown into a DOCX `Buffer`.
- Modify `src/server.js`: task streaming endpoint and Word download endpoint; keep legacy chat endpoints.
- Modify `src/promptBuilder.js`: export reusable task message construction helpers without relaxing legacy chat behavior.
- Modify `public/index.html`: task buttons, result metadata, manual correction controls, export command; remove the forced intake-only copy.
- Modify `public/app.js`: submit to the task endpoint without a mandatory A/B/C choice; display and correct inferred context; export latest result.
- Modify `public/styles.css`: task chooser and result metadata styles.
- Modify `package.json` and `package-lock.json`: add `docx`.
- Create `test/taskRouter.test.js`, `test/taskExecutor.test.js`, and `test/docxExporter.test.js`.
- Modify `test/promptBuilder.test.js`, `test/uiContract.test.js`, and server-facing tests if required by the extracted endpoint helpers.

### Task 1: Add deterministic task routing

**Files:**
- Create: `src/taskRouter.js`
- Test: `test/taskRouter.test.js`

- [ ] **Step 1: Write failing routing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMeetingTask } from '../src/taskRouter.js';

test('keeps an explicitly selected after-meeting task and meeting type', () => {
  assert.deepEqual(resolveMeetingTask({
    userInput: '请根据纪要告诉我下一步。',
    taskId: 'after_meeting',
    meetingType: 'B'
  }), {
    taskId: 'after_meeting',
    stage: 'after_meeting',
    meetingType: 'B',
    meetingTypeSource: 'explicit',
    needsClarification: false
  });
});

test('infers after-meeting and B from meeting minutes about data conditions', () => {
  const result = resolveMeetingTask({
    userInput: '会议纪要：客户的数据分散在多个系统，需要确认数据质量和试点范围。请给出下一步。'
  });
  assert.equal(result.taskId, 'after_meeting');
  assert.equal(result.stage, 'after_meeting');
  assert.equal(result.meetingType, 'B');
  assert.equal(result.needsClarification, false);
});

test('marks an underspecified request as needing one clarification', () => {
  const result = resolveMeetingTask({ userInput: '帮我看看怎么处理。' });
  assert.equal(result.needsClarification, true);
  assert.match(result.clarificationQuestion, /会前|会中|会后/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail because the module is absent**

Run: `npm test test/taskRouter.test.js`

Expected: failure reporting `ERR_MODULE_NOT_FOUND` for `src/taskRouter.js`.

- [ ] **Step 3: Implement the smallest router**

```js
const TASKS = new Set(['before_meeting', 'during_meeting', 'after_meeting']);

export function resolveMeetingTask({ userInput = '', taskId = '', meetingType = '' } = {}) {
  const text = String(userInput).toLowerCase();
  const explicitTask = TASKS.has(taskId) ? taskId : '';
  const resolvedTask = explicitTask || inferTask(text);
  const explicitType = ['A', 'B', 'C'].includes(String(meetingType).toUpperCase())
    ? String(meetingType).toUpperCase()
    : '';
  const inferredType = explicitType || inferMeetingType(text);
  const needsClarification = !resolvedTask;

  return {
    taskId: resolvedTask || 'after_meeting',
    stage: resolvedTask || 'after_meeting',
    meetingType: inferredType || 'B',
    meetingTypeSource: explicitType ? 'explicit' : inferredType ? 'inferred' : 'default',
    needsClarification,
    clarificationQuestion: needsClarification ? '这项内容是用于会前准备、会中追问，还是会后复盘？' : ''
  };
}

function inferTask(text) {
  if (/纪要|会后|下一步|复盘|行动项/.test(text)) return 'after_meeting';
  if (/正在开会|客户刚说|接下来该问|会中/.test(text)) return 'during_meeting';
  if (/明天|下周|会前|准备会议|即将/.test(text)) return 'before_meeting';
  return '';
}

function inferMeetingType(text) {
  if (/demo|poc|方案汇报|立项|决策/.test(text)) return 'C';
  if (/数据|系统现状|试点|详细需求|数据质量/.test(text)) return 'B';
  if (/首次|初次|了解需求|拜访/.test(text)) return 'A';
  return '';
}
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `npm test test/taskRouter.test.js`

Expected: all three tests pass.

### Task 2: Build task-scoped SOP prompts

**Files:**
- Create: `src/taskExecutor.js`
- Test: `test/taskExecutor.test.js`
- Modify: `src/promptBuilder.js`

- [ ] **Step 1: Write failing executor tests for SOP isolation and required output structure**

```js
test('buildTaskMessages injects only B after-meeting SOP for a B review task', () => {
  const messages = buildTaskMessages(content, {
    userInput: '根据会议纪要给出下一步。',
    task: { taskId: 'after_meeting', stage: 'after_meeting', meetingType: 'B' }
  });
  const text = messages[1].content;
  assert.match(text, /B类会后判断是否进入POC或方案深化/);
  assert.doesNotMatch(text, /A类只做客户基础调研/);
  assert.doesNotMatch(text, /C类检查Demo方案/);
  assert.match(text, /客户侧行动项/);
  assert.match(text, /我方行动项/);
  assert.match(text, /不得输出其他阶段标题/);
});

test('buildTaskMessages asks exactly one question when the router needs clarification', () => {
  const messages = buildTaskMessages(content, {
    userInput: '帮我看看怎么处理。',
    task: { needsClarification: true, clarificationQuestion: '这项内容是用于会前准备、会中追问，还是会后复盘？' }
  });
  assert.equal(messages[1].content, '这项内容是用于会前准备、会中追问，还是会后复盘？');
});
```

- [ ] **Step 2: Run the tests and confirm they fail because `buildTaskMessages` is missing**

Run: `npm test test/taskExecutor.test.js`

Expected: failure reporting that `buildTaskMessages` is not exported or the module does not exist.

- [ ] **Step 3: Implement `buildTaskMessages` with one selected meeting type and stage**

```js
import { buildChatMessages } from './promptBuilder.js';

export function buildTaskMessages(content, request) {
  const task = request.task || {};
  if (task.needsClarification) {
    return [{ role: 'system', content: content.skillPrompt }, { role: 'user', content: task.clarificationQuestion }];
  }

  const type = content.scene.meetingTypes.find((item) => item.id === task.meetingType);
  const node = (type?.sopNodes || []).find((item) => item.stage === task.stage);
  return buildChatMessages(content, {
    userInput: request.userInput,
    meetingType: task.meetingType,
    taskId: task.taskId,
    sopNodeId: node?.id,
    attachments: request.attachments,
    customerContext: request.customerContext || {},
    conversationHistory: request.conversationHistory || []
  });
}
```

Update the task prompt text in `src/promptBuilder.js` so `after_meeting` additionally requires: meeting conclusion, confirmed facts, gaps, customer actions, internal actions, next-step recommendation, and progression decision. Keep the existing stage-template title restrictions and unordered subheading rule.

- [ ] **Step 4: Add a post-generation output validator contract**

Export `validateTaskOutput(markdown, taskId)` from `src/taskExecutor.js`. It must return `{ valid: boolean, issues: string[] }`, reject headings belonging to a different stage template, reject numeric items below `###` headings, and for `after_meeting` require headings containing the terms `行动项` and `下一`.

- [ ] **Step 5: Run focused tests and the prompt builder regression suite**

Run: `npm test test/taskExecutor.test.js test/promptBuilder.test.js`

Expected: focused task tests pass and existing prompt tests remain green.

### Task 3: Expose task streaming and Word export endpoints

**Files:**
- Modify: `src/server.js`
- Create: `src/docxExporter.js`
- Test: `test/docxExporter.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write a failing DOCX exporter test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTaskResultDocx } from '../src/docxExporter.js';

test('exports Markdown headings and bullets as a non-empty DOCX buffer', async () => {
  const file = await exportTaskResultDocx({
    title: '会后复盘与下一步跟进',
    markdown: '## 1. 对内复盘\n### 1.1 本次交流结论\n- 客户认可方向。\n## 2. 对外跟进\n### 2.1 我方行动项\n- 确认 Demo 范围。'
  });
  assert.ok(Buffer.isBuffer(file));
  assert.ok(file.length > 500);
  assert.equal(file.subarray(0, 2).toString(), 'PK');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test test/docxExporter.test.js`

Expected: missing module failure.

- [ ] **Step 3: Install the local DOCX generator dependency**

Run: `npm install docx`

Expected: `package.json` lists `docx` and the lockfile is updated. This library runs in the Node.js service; it sends no document content to a public service.

- [ ] **Step 4: Implement the minimal DOCX exporter**

`exportTaskResultDocx({ title, markdown })` must split Markdown into `##`, `###`, `- ` and paragraph lines; map them respectively to `HeadingLevel.HEADING_1`, `HeadingLevel.HEADING_2`, bullet paragraphs, and body paragraphs; then return `Packer.toBuffer(document)`.

- [ ] **Step 5: Add server endpoints**

Add `POST /api/scenes/customer_communication/tasks/stream` that reads `{ userInput, taskId?, meetingType?, attachments?, conversationHistory? }`, calls `resolveMeetingTask`, returns a `clarification` SSE event when needed, otherwise streams the `buildTaskMessages` model result and emits a final `context` event containing `{ taskId, stage, meetingType, meetingTypeSource }`.

Add `POST /api/scenes/customer_communication/tasks/export-docx` that reads `{ title, markdown }`, calls `validateTaskOutput(markdown, 'after_meeting')`, returns `400` with issues if invalid, otherwise streams the DOCX buffer with `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` and an attachment filename.

Keep `/chat` and `/chat-stream` untouched for legacy operation.

- [ ] **Step 6: Run the DOCX test and syntax checks**

Run: `npm test test/docxExporter.test.js`

Expected: pass.

Run: `node --check src/server.js; node --check src/docxExporter.js`

Expected: no output and exit code 0.

### Task 4: Replace forced intake with the task workspace

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/uiContract.test.js`

- [ ] **Step 1: Write failing UI contract assertions**

```js
test('task workspace exposes three task choices and Word export', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  assert.match(html, /会前准备/);
  assert.match(html, /会中下一问/);
  assert.match(html, /会后复盘与下一步跟进/);
  assert.match(html, /id="exportDocxButton"/);
  assert.match(app, /tasks\/stream/);
  assert.doesNotMatch(app, /请先选择 A\/B\/C 交流类型/);
});
```

- [ ] **Step 2: Run the UI contract test and confirm it fails**

Run: `npm test test/uiContract.test.js`

Expected: the new task-workspace assertions fail.

- [ ] **Step 3: Change the HTML shell**

In `public/index.html`, replace the SOP-first explanatory copy with a task workspace header, add a three-button `#taskChooser` with `data-task-id` values `before_meeting`, `during_meeting`, and `after_meeting`, add `#taskContext` for inferred task/type/stage, and add a disabled `#exportDocxButton` next to the composer. Keep the document upload input and chat result panel.

- [ ] **Step 4: Change front-end state and submission**

Add `selectedTaskId`, `resolvedTask`, and `latestTaskResult` to `state`. On a task button click, set `selectedTaskId` but do not require A/B/C. Remove the `!state.meetingType` block from `sendMessage()`.

Replace `sendMessageAfterCustomerSync()` with `sendTaskRequest()` posting to `/api/scenes/${state.sceneId}/tasks/stream` and body:

```js
{
  userInput,
  taskId: state.selectedTaskId,
  meetingType: state.meetingType || undefined,
  attachments: attachmentRequestPayload(attachmentSnapshot),
  conversationHistory: recentConversationHistory()
}
```

Handle `context` SSE events by storing `state.resolvedTask` and rendering its stage/type. Handle a `clarification` SSE event as an assistant message. On `done`, store the generated Markdown in `state.latestTaskResult` and enable the Word button only when the task is `after_meeting`.

- [ ] **Step 5: Add export behavior**

Bind `#exportDocxButton` to a `fetch('/api/scenes/customer_communication/tasks/export-docx', ...)` call with `{ title: '会后复盘与下一步跟进', markdown: state.latestTaskResult }`. Convert the response to a Blob, create an object URL, and trigger download as `会后复盘与下一步跟进.docx`. Show a user-facing error message when the endpoint returns a validation error.

- [ ] **Step 6: Keep manual correction without forced intake**

Keep the existing A/B/C bar as a manual correction control. Selecting a type after a result updates `state.meetingType`, displays “已手动更正”，and permits regeneration. Do not open `intakeDialog` automatically on scene entry or task submission. The dialog remains available only from an explicit “补充客户信息” action.

- [ ] **Step 7: Style the task controls**

Add compact task-choice buttons and a context strip in `public/styles.css`; maintain existing color tokens and responsive behavior. The task chooser must remain a single row when there is room and wrap cleanly on narrow screens. Word export stays disabled until an eligible after-meeting result exists.

- [ ] **Step 8: Run UI checks**

Run: `npm test test/uiContract.test.js test/inlineSopExperience.test.js test/interactionRules.test.js`

Expected: all pass after updating only assertions that intentionally described mandatory intake.

Run: `node --check public/app.js`

Expected: no output and exit code 0.

### Task 5: Add task workflow regression coverage and verify the release

**Files:**
- Modify: `test/afterMeetingStructure.test.js`
- Modify: `test/interactionRules.test.js`
- Modify: `README.md`

- [ ] **Step 1: Add after-meeting workflow acceptance tests**

Add assertions that the after-meeting task prompt includes the selected A/B/C after-meeting node, requires both customer and internal actions, and keeps black bullets below secondary headings. Add assertions that a user can submit without `meetingType` when `taskId` is explicit.

- [ ] **Step 2: Update the README usage path**

Replace the mandatory “choose A/B/C before asking” instruction with: choose one of the three tasks or enter natural language; the system infers task/type and permits a manual correction; upload `.docx` for reading and export after-meeting reviews to `.docx`.

- [ ] **Step 3: Run the complete suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 4: Run final syntax and manual checks**

Run: `node --check public/app.js; node --check src/server.js; node --check src/taskRouter.js; node --check src/taskExecutor.js; node --check src/docxExporter.js`

Expected: no output and exit code 0.

Manual acceptance:

1. Enter “明天与客户首次沟通，帮我准备会议” without selecting A/B/C; verify a preparation result and inferred A/before context.
2. Enter a meeting-minutes paragraph containing data conditions; verify inferred B/after context and action items.
3. Click the after-meeting task, upload a DOCX or paste minutes, generate a result, and download a non-empty Word file.
4. Manually change the inferred A/B/C type and regenerate; verify the result uses only that type's SOP.
