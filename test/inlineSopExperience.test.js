import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('SOP steps render as a top flow with modal-only node details', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="sopList"/);
  assert.doesNotMatch(html, /id="nodeModal"/);
  assert.match(app, /expandedSectionIds: new Set\(\)/);
  assert.doesNotMatch(html, /currentNodePanel/);
  assert.doesNotMatch(app, /renderCurrentNodeDetail/);
  assert.doesNotMatch(html, /7 步 SOP 主流程/);
  assert.doesNotMatch(html, /<p class="eyebrow">客户交流会议<\/p>/);
  assert.match(html, /id="modelHealthSlot"/);
  assert.doesNotMatch(app, /insertAdjacentHTML/);
  assert.match(app, /toggleNodeSection/);
  assert.match(app, /toggleAllNodeSections/);
  assert.match(app, /本节关注点/);
  assert.match(app, /必做项/);
  assert.match(app, /建议项/);
  assert.match(app, /经验提醒/);
  assert.match(app, /常见错误/);
  assert.doesNotMatch(app, /id: 'aiQuestions'/);
});

test('workbench renders only the selected meeting type SOP', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /function currentSopNodes\(\)/);
  assert.match(app, /currentMeetingTypeConfig\(\)\?\.sopNodes/);
  assert.match(app, /state\.scene\.meetingTypes/);
  assert.doesNotMatch(app, /renderMeetingTypePlaybooks/);
  assert.doesNotMatch(app, /classificationNodeId/);
});

test('intake controls select meeting type before rendering SOP', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(app, /function renderIntakeDialog/);
  assert.match(app, /pendingMeetingType: null/);
  assert.match(app, /intakeMode: 'entry'/);
  assert.match(app, /function selectIntakeMeetingType\(type\)/);
  assert.match(app, /state\.sopNodeId = type\.sopNodes\[0\]\?\.id/);
  assert.doesNotMatch(app, /togglePlaybookStage/);
  assert.match(styles, /\.intake-type\.active/);
  assert.match(styles, /\.intake-fields/);
});

test('meeting type switching exposes SOP nodes for direct worksheet entry', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const selectMatch = app.match(/function selectMeetingTypeForSop\(type\) \{([\s\S]*?)\n\}/);
  const renderMeetingTypeBarMatch = app.match(/function renderMeetingTypeBar\(\) \{([\s\S]*?)\n\}/);

  assert.ok(selectMatch, 'meeting type selection should make the target SOP available');
  assert.match(selectMatch[1], /state\.meetingType = type\.id/);
  assert.match(selectMatch[1], /state\.sopNodeId = null/);
  assert.match(selectMatch[1], /state\.pendingStepRecommendation = null/);
  assert.match(selectMatch[1], /renderAll\(\)/);
  assert.match(renderMeetingTypeBarMatch?.[1] || '', /selectMeetingTypeForSop\(type\)/);
  assert.match(app, /loadWorksheet\(state\.meetingType, node\.stage, node\.id/);
});

test('conversation suggestions are compact, reply-scoped, and do not expose copy action', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="conversationSuggestions"/);
  assert.match(html, /id="questionMoreDialog"/);
  assert.match(app, /renderConversationSuggestions/);
  assert.match(app, /message-related/);
  assert.match(app, /openQuestionMoreDialog/);
  assert.doesNotMatch(app, /copySuggestedQuestion/);
  assert.doesNotMatch(app, /复制/);
});
test('workbench UI makes current context, ABC selection, and empty guidance explicit', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(app, /context-chip/);
  assert.match(app, /context-chip warning/);
  assert.match(app, /intakeCompleted/);
  assert.match(app, /section-count/);
  assert.match(app, /empty-chat-title/);
  assert.match(app, /可以这样问 AI/);
  assert.match(app, /模型响应超时，请稍后重试或联系管理员检查服务。/);
  assert.match(styles, /\.context-chip/);
  assert.match(styles, /\.intake-card/);
  assert.match(styles, /\.empty-chat-card/);
  assert.match(styles, /\.section-count/);
});

test('second-stage SOP UI supports semi-gated node modal and checklist state', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="nodeDetailDialog"/);
  assert.match(app, /openNodeDetailDialog/);
  assert.match(app, /refreshOpenNodeDetailDialog/);
  assert.match(app, /toggleNodeCompleted/);
  assert.match(app, /data-action="toggle-all"/);
  assert.match(app, /node-detail-tools/);
  assert.match(app, /section\.groups/);
  assert.match(app, /incompletePreviousNodes/);
  assert.match(app, /completedNodeIds: \[\.\.\.state\.completedNodeIds\]/);
  assert.match(app, /未完成前置节点/);
  assert.match(styles, /\.node-detail-dialog/);
  assert.match(styles, /\.node-detail-tools/);
  assert.match(styles, /\.detail-group-list/);
  assert.match(styles, /\.detail-group-title/);
  assert.match(styles, /\.complete-node-button/);
  assert.match(styles, /\.flow-warning/);
});

test('right context strip shows meeting type before current node', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const contextItemsMatch = app.match(/const contextItems = \[([\s\S]*?)\];/);

  assert.ok(contextItemsMatch, 'renderContext should define contextItems');
  assert.ok(
    contextItemsMatch[1].indexOf("label: '交流性质'") < contextItemsMatch[1].indexOf("label: '当前节点'"),
    '交流性质 should appear before 当前节点 in the right context strip'
  );
});

test('node detail toggle-all is not bound by generic accordion events', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const bindInlineDetailEventsMatch = app.match(/function bindInlineDetailEvents\(container, node\) \{([\s\S]*?)\n\}/);

  assert.ok(bindInlineDetailEventsMatch, 'bindInlineDetailEvents should exist');
  assert.doesNotMatch(bindInlineDetailEventsMatch[1], /data-action="toggle-all"/);
  assert.match(app, /querySelector\('\[data-action="toggle-all"\]'\)\?\.addEventListener\('click', \(\) => toggleAllNodeSections\(node\.id\)\)/);
});

test('node detail opens focus and must-do sections by default for new users', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /DEFAULT_OPEN_DETAIL_SECTIONS/);
  assert.match(app, /'focus'/);
  assert.match(app, /'mustDo'/);
  assert.match(app, /ensureDefaultDetailSectionsOpen\(node\)/);
});

test('stage flow heading explains natural-language task entry and SOP guidance', async () => {
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /直接输入会议需求、客户原话或会议纪要；系统会判断任务并按对应 SOP 输出。/);
  assert.match(html, /会议任务助手/);
});

test('first-batch UI polish keeps meeting type visible and clarifies AI context', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="meetingTypeBar"/);
  assert.match(html, /meeting-type-bar/);
  assert.match(app, /renderMeetingTypeBar/);
  assert.match(app, /stage-progress/);
  assert.match(html, /composer-context/);
  assert.match(app, /将按/);
  assert.match(app, /node-detail-meta/);
  assert.match(styles, /\.meeting-type-bar/);
  assert.match(styles, /\.stage-progress/);
  assert.match(styles, /\.composer-context/);
  assert.match(styles, /\.node-detail-meta/);
});

test('AI answers render markdown as styled HTML instead of raw star markers', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(app, /renderMarkdownContent/);
  assert.match(app, /markdown-line heading/);
  assert.match(app, /markdown-list/);
  assert.match(app, /formatInlineMarkdown/);
  assert.doesNotMatch(app, /message-body'\)\.textContent = message\.content/);
  assert.match(styles, /\.message-body \.markdown-line\.heading/);
  assert.match(styles, /\.message-body strong/);
  assert.match(styles, /\.message-body \.markdown-list/);
});

test('assistant markdown renderer keeps ordered lists only outside structured headings', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /function normalizeOrderedListNumbering/);
  assert.match(app, /normalizeOrderedListNumbering\(content\)/);
  assert.match(app, /const numbered = line\.match/);
  assert.match(app, /createMarkdownList\('ol'\)/);
  assert.match(app, /const isStructuredHeadingContent = currentHeadingLevel >= 2/);
  assert.match(app, /if \(isStructuredHeadingContent\) \{/);
});

test('assistant markdown renderer keeps heading and list numbering independent', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /headingCountersByLevel/);
  assert.match(app, /parentHeadingNumbers/);
  assert.match(app, /numberedListCounter/);
  assert.match(app, /normalizeHeadingNumber/);
  assert.match(app, /normalizeNumberedListItem/);
  assert.doesNotMatch(app, /if \(!line\.trim\(\)\) \{\s*listCounter = 0;/s);
});


test('assistant markdown renderer converts subheading content to bullet lists', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /activeList/);
  assert.match(app, /activeListType/);
  assert.match(app, /currentHeadingKey/);
  assert.match(app, /isStructuredHeadingContent/);
  assert.match(app, /appendSubheadingBulletItem/);
  assert.match(app, /createMarkdownList\('ul'\)/);
  assert.match(app, /listCountersByHeading/);
  assert.match(app, /结构化标题下内容统一使用黑点列表/);
  assert.doesNotMatch(app, /if \(line\.trim\(\) && !line\.trim\(\)\.match\(\/\^\[-\*\]\\s\+\/\)\) numberedListCounter = 0;/);
});

test('assistant markdown renderer converts repeated numbered items under section headings to bullets', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const renderMatch = app.match(/function renderMarkdownContent\(container, content\) \{([\s\S]*?)\n\}/);

  assert.ok(renderMatch, 'renderMarkdownContent should exist');
  assert.match(renderMatch[1], /const isStructuredHeadingContent = currentHeadingLevel >= 2/);
  assert.ok(
    renderMatch[1].indexOf("if (isStructuredHeadingContent)") < renderMatch[1].indexOf("createMarkdownList('ol')"),
    'numbered items under ##/### headings should be converted to bullets before any ordered list is created'
  );
  assert.match(renderMatch[1], /appendSubheadingBulletItem\(fragment, activeList, activeListType, numbered\[1\]\)/);
});
test('second-batch UI polish improves assistant, modal actions, and mobile layout', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(app, /loading-dots/);
  assert.doesNotMatch(app, /正在基于当前类型、阶段和节点生成建议/);
  assert.doesNotMatch(app, /loading-message/);
  assert.match(styles, /\.message\.loading/);
  assert.match(styles, /\.assistant-panel/);
  assert.match(styles, /\.suggestion-list\.compact/);
  assert.match(styles, /\.inline-question-list button/);
  assert.match(styles, /\.detail-accordion\[data-section-id="stagePlaybook"\]/);
  assert.match(styles, /\.sop-stage-card/);
  assert.match(styles, /\.model-health/);
  assert.match(styles, /\.loading-dots/);
  assert.match(styles, /@keyframes loading-dots/);
  assert.match(styles, /@media \(max-width: 860px\)/);
  assert.match(styles, /\.hierarchy-shell/);
  assert.match(styles, /overflow-x: hidden/);
});

test('assistant empty state shows current-node suggestions inside chat log and no backend proxy label', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.doesNotMatch(html, /后端代理/);
  assert.doesNotMatch(html, /modelStatus/);
  assert.match(app, /function renderChat\(\)/);
  assert.match(app, /state\.messages\.length === 0/);
  assert.match(app, /可以这样问 AI/);
  assert.match(app, /questionsForCurrentNode\('default', 3\)/);
  assert.doesNotMatch(app, /AI 会按当前 SOP 节点生成建议/);
  assert.match(styles, /\.empty-chat-card/);
  assert.match(styles, /\.suggestion-list\.compact/);
});

test('model health result wraps instead of truncating on the top right', async () => {
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(styles, /\.model-health \{[^}]*minmax\(160px, 320px\)/s);
  assert.doesNotMatch(styles, /\.model-health-result \{[^}]*text-overflow: ellipsis/s);
  assert.doesNotMatch(styles, /\.model-health-result \{[^}]*white-space: nowrap/s);
  assert.match(styles, /\.model-health-result \{[^}]*white-space: normal/s);
  assert.match(styles, /\.model-health-result \{[^}]*overflow-wrap: anywhere/s);
});

test('right assistant layout prioritizes AI answer reading space', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(app, /questionsForCurrentNode\('default', 2\)/);
  assert.match(styles, /\/\* Right assistant answer-space optimization \*\//);
  assert.match(styles, /\.context-strip \{[^}]*padding: 6px/s);
  assert.match(styles, /\.context-chip \{[^}]*padding: 5px 6px/s);
  assert.match(styles, /\.conversation-suggestions \{[^}]*padding: 6px 8px/s);
  assert.match(styles, /\.chat-log \{[^}]*padding: 8px/s);
  assert.match(styles, /\.message \{[^}]*margin-bottom: 7px/s);
  assert.match(html, /<textarea id="userInput" rows="1"/);
  assert.match(app, /function autoResizeUserInput\(\)/);
  assert.match(app, /els\.userInput\.addEventListener\('input', autoResizeUserInput\)/);
  assert.match(app, /autoResizeUserInput\(\);\n\s*els\.userInput\.focus\(\)/);
  assert.match(app, /els\.userInput\.value = '';\n\s*autoResizeUserInput\(\)/);
  assert.match(styles, /\.composer \{[^}]*padding: 6px 8px 7px/s);
  assert.match(styles, /\.composer-context \{[^}]*min-height: 18px/s);
  assert.match(styles, /\.composer textarea \{[^}]*min-height: 42px/s);
  assert.match(styles, /\.composer textarea \{[^}]*max-height: 118px/s);
  assert.match(styles, /#sendButton \{[^}]*min-height: 30px/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.composer textarea \{[^}]*min-height: 52px/);
});

test('composer uses in-input GPT-style generate and stop control', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(html, /class="composer-input-shell"/);
  assert.match(html, /<button type="submit" id="sendButton" aria-label="生成">生成<\/button>/);
  assert.doesNotMatch(html, /生成建议/);
  assert.match(app, /currentAbortController: null/);
  assert.match(app, /function stopCurrentGeneration\(\)/);
  assert.match(app, /signal: controller\.signal/);
  assert.match(app, /setAttribute\('aria-label', isLoading \? '停止生成' : '生成'\)/);
  assert.match(app, /sendButton\.classList\.toggle\('is-stopping'/);
  assert.match(styles, /\.composer-input-shell \{/);
  assert.match(styles, /#sendButton\.is-stopping/);
  assert.match(styles, /\.stop-icon/);
});


test('composer supports GPT-style left attachment button and single-use document context', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="attachButton"/);
  assert.match(html, /aria-label="上传文档"/);
  assert.match(html, /id="attachmentInput" type="file" accept="\.md,\.markdown,\.docx"/);
  assert.match(html, /id="attachmentChip"/);
  assert.match(html, /id="removeAttachmentButton"/);
  assert.match(app, /attachment: EMPTY_ATTACHMENT_STATE/);
  assert.match(app, /handleAttachmentSelection/);
  assert.match(app, /createAttachmentState/);
  assert.match(app, /fetch\('\/api\/attachments\/docx-text'/);
  assert.match(app, /function snapshotAttachment\(\)/);
  assert.match(app, /status: 'reading'/);
  assert.match(app, /resolveAttachmentSnapshotForSend\(state\.attachment\)/);
  assert.match(app, /attachmentSnapshot = await snapshotAttachment\(\)/);
  assert.match(app, /state\.pendingCustomerSync = \{ userInput, candidates, attachmentSnapshot \}/);
  assert.match(app, /sendMessageAfterCustomerSync\(userInput, pending\.attachmentSnapshot\)/);
  assert.match(app, /sendMessageAfterCustomerSync\(pending\.userInput, pending\.attachmentSnapshot\)/);
  assert.match(app, /attachments: attachmentRequestPayload\(attachmentSnapshot\)/);
  assert.doesNotMatch(app, /attachments: state\.attachment \? \[state\.attachment\] : \[\]/);
  assert.match(app, /clearAttachment\(\);/);
  assert.doesNotMatch(app, /clearAttachment\(\);\s*clearAttachment\(\);/s);
  assert.match(app, /els\.attachButton\.disabled = isLoading/);
  assert.match(styles, /\.composer-attach \{[^}]*left: 7px/s);
  assert.match(styles, /\.composer textarea \{[^}]*padding: 8px 66px 8px 44px/s);
  assert.match(styles, /\.composer-input-shell\.has-attachment/);
  assert.match(styles, /\.composer-attachment-chip \{[^}]*position: absolute/s);
  assert.match(styles, /\.composer-attachment-chip \{[^}]*top: 6px/s);
  assert.match(app, /DEFAULT_ATTACHMENT_PROMPT/);
  assert.match(app, /const messageInput = userInput \|\| \(attachmentSnapshot \? DEFAULT_ATTACHMENT_PROMPT : ''\)/);
  assert.match(styles, /#sendButton \{[^}]*right: 7px/s);
});


test('right context uses clear customer information wording', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /客户信息 \$\{filled\}\/\$\{total\}/);
  assert.doesNotMatch(app, /已填写 \$\{filled\}\/\$\{total\}/);
  assert.doesNotMatch(app, /\$\{customerName \|\| '客户未填写'\} \/ 已填写/);
});
test('server exposes transient docx attachment parsing endpoint', async () => {
  const server = await readFile('src/server.js', 'utf8');
  const pkg = await readFile('package.json', 'utf8');

  assert.match(server, /import mammoth from 'mammoth'/);
  assert.match(server, /\/api\/attachments\/docx-text/);
  assert.match(server, /parseDocxAttachment/);
  assert.match(server, /mammoth\.extractRawText/);
  assert.match(server, /readBinaryBody\(request, 2 \* 1024 \* 1024\)/);
  assert.match(pkg, /"mammoth"/);
});
test('third-stage color system separates workflow, AI, completion, warning, and error states', async () => {
  const styles = await readFile('public/styles.css', 'utf8');

  assert.match(styles, /--accent: #2563eb/);
  assert.match(styles, /--accent-dark: #1d4ed8/);
  assert.match(styles, /--accent-soft: #eff6ff/);
  assert.match(styles, /--success: #15803d/);
  assert.match(styles, /--success-soft: #ecfdf3/);
  assert.match(styles, /--warning: #b7791f/);
  assert.match(styles, /--warning-soft: #fef3c7/);
  assert.match(styles, /--info: #2f5f9f/);
  assert.match(styles, /--info-soft: #eef5ff/);
  assert.match(styles, /\.sop-step\.completed \{[^}]*border-color: var\(--success\)[^}]*background: var\(--success-soft\)/s);
  assert.match(styles, /\.message\.assistant \{[^}]*border-left: 4px solid var\(--info\)/s);
  assert.match(styles, /\.message\.user \{[^}]*border-color: var\(--info-line\)[^}]*background: var\(--info-soft\)/s);
  assert.match(styles, /\.context-chip\.warning \{[^}]*border-color: var\(--warning-line\)[^}]*background: var\(--warning-soft\)/s);
  assert.match(styles, /\.message\.error \{[^}]*border-color: var\(--error-line\)[^}]*background: var\(--error-soft\)/s);
});

test('home page highlights available presales SOP scene without empty overview stats', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const styles = await readFile('public/styles.css', 'utf8');

  assert.doesNotMatch(html, /SOP 主流程/);
  assert.doesNotMatch(html, /信息保存/);
  assert.match(html, /已启用/);
  assert.match(html, /售前 SOP 场景/);
  assert.match(html, /选择可用场景进入工作台/);
  assert.match(app, /title: '客户交流会议', status: '已启用', enabled: true/);
  assert.doesNotMatch(app, /title: 'SOP 学习与问答', status: '已启用', enabled: true/);
  assert.doesNotMatch(app, /title: '会议执行助手', status: '已启用', enabled: true/);
  assert.match(app, /title: '需求澄清', status: '后续完善', enabled: false/);
  assert.match(app, /title: '方案交流', status: '后续完善', enabled: false/);
  assert.match(app, /title: 'POC 规划', status: '后续完善', enabled: false/);
  assert.match(styles, /\.scene-overview \{[^}]*grid-template-columns: minmax\(0, 240px\)/s);
  assert.match(styles, /\.scene-section \{[^}]*padding: 22px/s);
  assert.match(styles, /\.scene-card\.enabled \{[^}]*border-color: var\(--accent\)/s);
});








