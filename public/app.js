import { attachmentRequestPayload, createAttachmentState, EMPTY_ATTACHMENT_STATE, resolveAttachmentSnapshotForSend } from './attachmentHelpers.js';
import { readSseStream } from './sse.js';

const SALES_SOP_SCENES = [
  { id: 'customer_communication', title: '客户交流会议', status: '已启用', enabled: true, summary: '涵盖日常 SOP 学习与问答，以及实际工作中的会议资料整理和跟进。', meta: '学习与工作' },
  { id: 'requirement_clarification', title: '需求澄清', status: '后续完善', enabled: false, summary: '将客户兴趣和初步问题拆解为业务场景、角色、数据、约束和成功标准。', meta: '需求推进' },
  { id: 'solution_communication', title: '方案交流', status: '后续完善', enabled: false, summary: '围绕价值逻辑、能力边界、实施路径和客户决策事项组织方案沟通。', meta: '方案推进' },
  { id: 'poc_planning', title: 'POC 规划', status: '后续完善', enabled: false, summary: '判断数据、样例、评价人、验证范围和反馈机制是否足以支撑 POC。', meta: '验证设计' },
  { id: 'technical_followup', title: '继续技术交流', status: '后续完善', enabled: false, summary: '面向未完全澄清的问题组织下一轮技术沟通，控制投入和承诺边界。', meta: '持续跟进' },
  { id: 'ae_sales_followup', title: 'AE/销售推进商务关系', status: '后续完善', enabled: false, summary: '识别需要销售侧推进的关系、窗口、预算、立项路径和关键联系人。', meta: '商务协同' },
  { id: 'pause_followup', title: '暂缓跟进', status: '后续完善', enabled: false, summary: '当客户意愿、数据条件、价值空间或推进路径不足时，沉淀原因并降低投入。', meta: '资源判断' }
];

const DETAIL_SECTION_DEFS = [
  { id: 'focus', title: '本节关注点', getItems: (node) => node.focus ? [node.focus] : [] },
  { id: 'mustDo', title: '必做项', getItems: (node) => node.mustDo },
  { id: 'suggested', title: '建议项', getItems: (node) => node.suggested },
  { id: 'experienceTips', title: '经验提醒', getItems: (node) => node.experienceTips },
  { id: 'commonMistakes', title: '常见错误', getItems: (node) => node.commonMistakes },
  { id: 'outputs', title: '本节点输出物', getItems: (node) => node.outputs },
  { id: 'guardrails', title: '不可承诺/需内部确认', getItems: (node) => node.guardrails },
  { id: 'resources', title: '相关资料入口', getItems: (node) => formatResources(node.resources) }
];

const DEFAULT_OPEN_DETAIL_SECTIONS = ['focus', 'mustDo'];

const DEFAULT_ATTACHMENT_PROMPT = '请结合上传文档，按当前 SOP 节点生成建议。';

const STAGE_DEFS = [
  { id: 'before_meeting', title: '会前', subtitle: '准备' },
  { id: 'during_meeting', title: '会中', subtitle: '推进' },
  { id: 'after_meeting', title: '会后', subtitle: '判断' }
];

const state = {
  view: 'home',
  sceneId: 'customer_communication',
  scene: null,
  questions: null,
  playbooks: null,
  reviewTemplate: null,
  meetingType: '',
  customerContext: {},
  intakeCompleted: false,
  pendingMeetingType: null,
  pendingCustomerContext: null,
  intakeMode: 'entry',
  sopNodeId: null,
  selectedRecommendedQuestion: null,
  expandedNodeIds: new Set(),
  expandedSectionIds: new Set(),
  completedNodeIds: new Set(),
  pendingCustomerSync: null,
  attachment: EMPTY_ATTACHMENT_STATE,
  currentAbortController: null,
  isGenerating: false,
  selectedTaskId: '',
  latestTaskResult: '',
  pendingStepRecommendation: null,
  worksheetSource: { userInput: '', attachments: [] },
  currentWorksheet: null,
  messages: []
};

const els = {
  homeView: document.querySelector('#homeView'),
  sceneView: document.querySelector('#sceneView'),
  sceneCards: document.querySelector('#sceneCards'),
  meetingEntryDialog: document.querySelector('#meetingEntryDialog'),
  closeMeetingEntry: document.querySelector('#closeMeetingEntry'),
  openSopLearning: document.querySelector('#openSopLearning'),
  openMeetingExecution: document.querySelector('#openMeetingExecution'),
  backHomeButton: document.querySelector('#backHomeButton'),
  sceneTitle: document.querySelector('#sceneTitle'),
  scenePurpose: document.querySelector('#scenePurpose'),
  meetingTypeBar: document.querySelector('#meetingTypeBar'),
  sopList: document.querySelector('#sopList'),
  intakeDialog: document.querySelector('#intakeDialog'),
  intakeTitle: document.querySelector('#intakeDialog h2'),
  intakeCopy: document.querySelector('.intake-copy'),
  intakeMeetingTypes: document.querySelector('#intakeMeetingTypes'),
  intakeFields: document.querySelector('#intakeFields'),
  intakeError: document.querySelector('#intakeError'),
  submitIntake: document.querySelector('#submitIntake'),
  nodeDetailDialog: document.querySelector('#nodeDetailDialog'),
  nodeDetailContent: document.querySelector('#nodeDetailContent'),
  customerSyncDialog: document.querySelector('#customerSyncDialog'),
  customerSyncFields: document.querySelector('#customerSyncFields'),
  closeCustomerSync: document.querySelector('#closeCustomerSync'),
  confirmCustomerSync: document.querySelector('#confirmCustomerSync'),
  skipCustomerSync: document.querySelector('#skipCustomerSync'),
  modelHealthSlot: document.querySelector('#modelHealthSlot'),
  contextStrip: document.querySelector('#contextStrip'),
  conversationSuggestions: document.querySelector('#conversationSuggestions'),
  modelHealthButton: null,
  modelHealthResult: null,
  chatLog: document.querySelector('#chatLog'),
  composer: document.querySelector('#composer'),
  composerContext: document.querySelector('#composerContext'),
  userInput: document.querySelector('#userInput'),
  attachButton: document.querySelector('#attachButton'),
  attachmentInput: document.querySelector('#attachmentInput'),
  attachmentChip: document.querySelector('#attachmentChip'),
  attachmentName: document.querySelector('#attachmentName'),
  removeAttachmentButton: document.querySelector('#removeAttachmentButton'),
  sendButton: document.querySelector('#sendButton'),
  taskChooser: document.querySelector('#taskChooser'),
  stepConfirmation: document.querySelector('#stepConfirmation'),
  worksheet: document.querySelector('#worksheet'),
  questionMoreDialog: document.querySelector('#questionMoreDialog'),
  closeQuestionMore: document.querySelector('#closeQuestionMore'),
  moreQuestionList: document.querySelector('#moreQuestionList')
};

init().catch(renderFatalError);

async function init() {
  const response = await fetch(`/api/scenes/${state.sceneId}/config`);
  if (!response.ok) throw new Error('配置加载失败');

  const config = await response.json();
  state.scene = config.scene;
  state.questions = config.questions;
  state.playbooks = config.playbooks;
  state.reviewTemplate = config.reviewTemplate;

  els.sceneTitle.textContent = state.scene.sceneName || '客户交流会议';
  els.scenePurpose.textContent = state.scene.purpose || els.scenePurpose.textContent;
  createModelHealthControls();
  bindEvents();
  renderAll();
}

function bindEvents() {
  els.backHomeButton.addEventListener('click', () => { state.view = 'home'; renderAll(); });
  els.meetingEntryDialog.addEventListener('click', closeDialogOnBackdrop);
  els.closeMeetingEntry.addEventListener('click', () => els.meetingEntryDialog.close());
  els.openSopLearning.addEventListener('click', () => openMeetingAssistant('sop_learning'));
  els.openMeetingExecution.addEventListener('click', () => openMeetingAssistant('meeting_execution'));
  els.composer.addEventListener('submit', async (event) => { event.preventDefault(); await sendMessage(); });
  els.userInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      await sendMessage();
    }
  });
  els.userInput.addEventListener('input', autoResizeUserInput);
  els.attachButton.addEventListener('click', () => els.attachmentInput.click());
  els.attachmentInput.addEventListener('change', handleAttachmentSelection);
  els.removeAttachmentButton.addEventListener('click', clearAttachment);
  els.intakeDialog.addEventListener('click', closeDialogOnBackdrop);
  els.intakeDialog.addEventListener('close', resetPendingIntake);
  els.nodeDetailDialog.addEventListener('click', closeDialogOnBackdrop);
  els.customerSyncDialog.addEventListener('click', closeDialogOnBackdrop);
  els.questionMoreDialog.addEventListener('click', closeDialogOnBackdrop);
  els.closeCustomerSync.addEventListener('click', () => continueWithoutCustomerSync());
  els.confirmCustomerSync.addEventListener('click', confirmCustomerSyncAndSend);
  els.skipCustomerSync.addEventListener('click', continueWithoutCustomerSync);
  els.closeQuestionMore.addEventListener('click', () => els.questionMoreDialog.close());
  els.submitIntake.addEventListener('click', submitIntake);
  els.modelHealthButton.addEventListener('click', checkModelHealth);
  els.worksheet.addEventListener('click', (event) => {
    if (event.target.closest('#exportDocxButton')) exportLatestReview();
  });
}

function renderAll() {
  renderView();
  renderSceneCards();
  renderMeetingTypeBar();
  renderSopList();
  renderContext();
  renderComposerContext();
  renderConversationSuggestions();
  renderChat();
}

function renderView() {
  els.homeView.classList.toggle('hidden', state.view !== 'home');
  els.sceneView.classList.toggle('hidden', state.view !== 'sop_learning');
  document.querySelector('#executionView')?.classList.toggle('hidden', state.view !== 'meeting_execution');
}

function renderSceneCards() {
  els.sceneCards.replaceChildren(...SALES_SOP_SCENES.map((scene) => {
    const card = document.createElement(scene.enabled ? 'button' : 'div');
    card.className = `scene-card${scene.enabled ? ' enabled' : ' disabled'}`;
    if (scene.enabled) {
      card.type = 'button';
      card.addEventListener('click', () => {
        if (scene.id === 'customer_communication') {
          els.meetingEntryDialog.showModal();
        }
      });
    }
    card.innerHTML = `
      <div class="scene-card-top"><span class="scene-status">${escapeHtml(scene.status)}</span><span class="scene-meta">${escapeHtml(scene.meta)}</span></div>
      <h3>${escapeHtml(scene.title)}</h3>
      <p>${escapeHtml(scene.summary)}</p>
    `;
    return card;
  }));
}

function openMeetingAssistant(view) {
  els.meetingEntryDialog.close();
  state.view = view;
  renderAll();
}

function renderSopList() {
  renderStageFlow();
}

function renderMeetingTypeBar() {
  if (!els.meetingTypeBar) return;
  const types = state.scene?.meetingTypes || [];
  els.meetingTypeBar.replaceChildren(...types.map((type) => {
    const button = document.createElement('button');
    const isActive = type.id === state.meetingType;
    button.type = 'button';
    button.className = `meeting-type-pill${isActive ? ' active' : ''}`;
    button.innerHTML = `
      <span>${escapeHtml(type.id)} 类</span>
      <strong>${escapeHtml(type.name)}</strong>
    `;
    button.addEventListener('click', () => {
      if (type.id !== state.meetingType) selectMeetingTypeForSop(type);
    });
    return button;
  }));
}

function selectMeetingTypeForSop(type) {
  state.meetingType = type.id;
  state.sopNodeId = null;
  state.selectedRecommendedQuestion = null;
  state.pendingStepRecommendation = null;
  els.stepConfirmation.replaceChildren();
  renderAll();
}

function renderStageFlow() {
  els.sopList.replaceChildren(...STAGE_DEFS.map((stage, index) => {
    const stageCard = document.createElement('section');
    const nodes = nodesForStage(stage.id);
    const completedCount = nodes.filter((node) => state.completedNodeIds.has(node.id)).length;
    stageCard.className = `sop-stage-card${nodes.some((node) => node.id === state.sopNodeId) ? ' active' : ''}`;
    stageCard.innerHTML = `
      <div class="sop-stage-head">
        <div>
          <span class="sop-stage-kicker">${escapeHtml(stage.subtitle)}</span>
          <h3>${escapeHtml(stage.title)}</h3>
        </div>
        <span class="stage-progress">${completedCount}/${nodes.length}</span>
        ${index < STAGE_DEFS.length - 1 ? '<span class="sop-stage-arrow" aria-hidden="true">→</span>' : ''}
      </div>
      <p class="sop-stage-summary">${escapeHtml(stageSummary(stage.id))}</p>
      <div class="sop-stage-steps"></div>
    `;
    const list = stageCard.querySelector('.sop-stage-steps');
    list.replaceChildren(...nodes.map(renderSopNodeWrap));
    return stageCard;
  }));
}

function renderSopNodeWrap(node) {
    const wrap = document.createElement('section');
    wrap.className = `sop-node-wrap${node.id === state.sopNodeId ? ' active' : ''}`;
    wrap.innerHTML = renderSopNodeButton(node);
    wrap.querySelector('.sop-step').addEventListener('click', () => selectSopNode(node.id));
    wrap.querySelector('[data-action="toggle-complete"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleNodeCompleted(node.id);
    });
    return wrap;
}

function nodesForStage(stageId) {
  return currentSopNodes().filter((node) => stageIdForNode(node) === stageId);
}

function stageIdForNode(node) {
  if (STAGE_DEFS.some((stage) => stage.id === node?.stage)) return node.stage;
  return 'before_meeting';
}

function currentPlaybookStage(stageId) {
  const typeId = state.meetingType || currentMeetingTypeConfig()?.id;
  const playbook = state.playbooks?.[typeId];
  return playbook?.stages?.find((stage) => stage.id === stageId) || null;
}

function stageSummary(stageId) {
  const stage = currentPlaybookStage(stageId);
  if (!stage) return '选择 A/B/C 类型后展示当前阶段打法。';
  const firstItems = (stage.sections || []).flatMap((section) => section.items || []).slice(0, 2);
  return firstItems.length ? firstItems.join(' ') : `${stage.name || '当前阶段'}暂无摘要。`;
}

function renderSopNodeButton(node) {
  const status = nodeStatus(node);
  const checked = state.completedNodeIds.has(node.id) ? 'true' : 'false';
  return `
    <button class="sop-step ${status.className}" type="button">
      <span class="step-num">STEP ${padStep(node.step)}</span>
      <span class="step-title">${escapeHtml(node.title)}</span>
      <span class="step-summary">${escapeHtml(node.summary || '')}</span>
      <span class="step-state">${escapeHtml(status.label)}</span>
      <span class="complete-node-button" role="checkbox" aria-checked="${checked}" data-action="toggle-complete" title="标记完成">${checked === 'true' ? '✓' : ''}</span>
    </button>
  `;
}

function currentMeetingTypeConfig() {
  return state.scene?.meetingTypes?.find((type) => type.id === state.meetingType) || null;
}

function currentSopNodes() {
  return currentMeetingTypeConfig()?.sopNodes || [];
}

function renderIntakeDialog() {
  const type = currentIntakeType();
  if (els.intakeTitle) {
    els.intakeTitle.textContent = state.intakeMode === 'switch' ? '切换客户交流类型' : '选择客户交流类型';
  }
  if (els.intakeCopy) {
    els.intakeCopy.textContent = state.intakeMode === 'switch'
      ? '切换交流类型，需要补充该类型关键信息；同名客户信息会自动保留。'
      : '必须先选择 A/B/C 类型，并补充必填客户信息；不清楚时可填写“待确认”。';
  }
  if (els.submitIntake) {
    els.submitIntake.textContent = state.intakeMode === 'switch' ? '确认切换' : '进入工作台';
  }
  els.intakeMeetingTypes.replaceChildren(...state.scene.meetingTypes.map((type) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `intake-type${currentIntakeType()?.id === type.id ? ' active' : ''}`;
    button.textContent = `${type.id} 类 ${type.name}`;
    button.addEventListener('click', () => {
      selectIntakeMeetingType(type);
      clearIntakeError();
      renderIntakeDialog();
    });
    return button;
  }));
  renderIntakeFields();
}

function openEntryIntake(type = null) {
  state.intakeMode = 'entry';
  if (type) selectIntakeMeetingType(type);
  renderIntakeDialog();
  showModal(els.intakeDialog);
}

function beginMeetingTypeSwitch(type) {
  state.intakeMode = 'switch';
  state.pendingMeetingType = type;
  state.pendingCustomerContext = preserveCustomerContextForType(type);
  renderIntakeDialog();
  showModal(els.intakeDialog);
}

function selectIntakeMeetingType(type) {
  const sourceContext = currentIntakeContext();
  state.pendingMeetingType = type;
  state.pendingCustomerContext = preserveCustomerContextForType(type, sourceContext);
}

function applyMeetingType(type, customerContext, options = {}) {
  state.meetingType = type.id;
  state.customerContext = customerContext;
  state.sopNodeId = type.sopNodes[0]?.id || null;
  state.selectedRecommendedQuestion = null;
  if (options.complete) state.intakeCompleted = true;
}

function preserveCustomerContextForType(type, sourceContext = state.customerContext) {
  const allowedFieldIds = new Set((type.intakeSchema || []).map((field) => field.id));
  return Object.fromEntries(
    Object.entries(sourceContext)
      .filter(([fieldId, value]) => allowedFieldIds.has(fieldId) && String(value || '').trim())
  );
}

function currentIntakeType() {
  return state.pendingMeetingType || currentMeetingTypeConfig();
}

function currentIntakeContext() {
  return state.pendingCustomerContext || state.customerContext;
}

function updateIntakeContext(fieldId, value) {
  if (!state.pendingCustomerContext) state.pendingCustomerContext = {};
  state.pendingCustomerContext[fieldId] = value;
}

function resetPendingIntake() {
  state.pendingMeetingType = null;
  state.pendingCustomerContext = null;
  state.intakeMode = 'entry';
  clearIntakeError();
}

function renderIntakeFields() {
  const type = currentIntakeType();
  if (!type) {
    els.intakeFields.replaceChildren();
    return;
  }
  const customerContext = currentIntakeContext();
  els.intakeFields.replaceChildren(...type.intakeSchema.map((field) => {
    const label = document.createElement('label');
    label.className = 'intake-field';
    label.innerHTML = `<span>${escapeHtml(field.label)}${field.required ? ' *' : ''}</span>`;
    const input = document.createElement('input');
    input.value = customerContext[field.id] || '';
    input.placeholder = field.required ? '必填项' : '可选项';
    input.addEventListener('input', () => {
      updateIntakeContext(field.id, input.value);
      clearIntakeError();
    });
    label.append(input);
    return label;
  }));
}

function submitIntake() {
  const type = currentIntakeType();
  if (!type) {
    pushMessage('error', '请先选择 A/B/C 交流类型。');
    return;
  }
  const customerContext = currentIntakeContext();
  const missingFields = missingRequiredIntakeFields(type, customerContext);
  if (missingFields.length) {
    renderIntakeError(`请补充必填项：${missingFields.map((field) => field.label).join('、')}`);
    return;
  }
  if (state.intakeMode === 'switch') {
    applyMeetingType(type, customerContext);
    state.expandedNodeIds.add(state.sopNodeId);
    els.intakeDialog.close();
    renderAll();
    return;
  }
  applyMeetingType(type, customerContext, { complete: true });
  state.expandedNodeIds.add(state.sopNodeId);
  els.intakeDialog.close();
  renderAll();
}

function missingRequiredIntakeFields(type, customerContext = state.customerContext) {
  return (type.intakeSchema || []).filter((field) => field.required && !String(customerContext[field.id] || '').trim());
}

function renderIntakeError(message) {
  if (!els.intakeError) return;
  els.intakeError.textContent = message;
  els.intakeError.classList.remove('hidden');
}

function clearIntakeError() {
  if (!els.intakeError) return;
  els.intakeError.textContent = '';
  els.intakeError.classList.add('hidden');
}

function stageTitleForNode(node) {
  const stage = STAGE_DEFS.find((item) => item.id === stageIdForNode(node));
  return stage?.title || '当前阶段';
}

function detailSectionsForNode(node) {
  const playbookSection = stageDetailSectionForNode(node);
  const nodeSections = DETAIL_SECTION_DEFS
    .map((def) => enrichDetailSectionForNode(node, { ...def, items: def.getItems(node) }))
    .filter((section) => Array.isArray(section.items) && section.items.length > 0);
  return [playbookSection, ...nodeSections].filter(Boolean);
}

function enrichDetailSectionForNode(node, section) {
  if (section.id !== 'mustDo' || stageIdForNode(node) !== 'after_meeting') return section;
  const groups = afterMeetingMustDoGroupsForNode(node);
  return groups ? { ...section, groups } : section;
}

function stageDetailSectionForNode(node) {
  const stage = currentPlaybookStage(stageIdForNode(node));
  if (!stage) return null;
  const groups = (stage.sections || [])
    .map((section) => ({ title: section.title, items: section.items || [] }))
    .filter((group) => group.title && group.items.length > 0);
  const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  return groups.length ? { id: 'stagePlaybook', title: '当前阶段打法', groups, items: new Array(itemCount).fill('') } : null;
}

function afterMeetingMustDoGroupsForNode(node) {
  const items = Array.isArray(node.mustDo) ? node.mustDo : [];
  if (!items.length) return null;
  const externalStartIndex = items.findIndex((item) => item.includes('客户侧行动项') || item.includes('下一次交流主题'));
  if (externalStartIndex < 0) return null;
  return [
    { title: '对内复盘', items: items.slice(0, externalStartIndex) },
    { title: '对外跟进', items: items.slice(externalStartIndex) }
  ].filter((group) => group.items.length > 0);
}

function renderDetailAccordion(node, section) {
  const key = sectionKey(node.id, section.id);
  const isOpen = state.expandedSectionIds.has(key);
  const countLabel = section.items.length ? '<span class="section-count">' + section.items.length + '</span>' : '';
  const isStagePlaybook = section.id === 'stagePlaybook';
  const content = Array.isArray(section.groups)
    ? renderDetailGroups(section.groups)
    : section.kind === 'questions'
    ? `<div class="inline-question-list quick-ai-actions">${section.items.map((question) => `<button type="button" data-question="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join('')}</div>`
    : `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;

  return `
    <section class="detail-accordion${isOpen ? ' open' : ''}${isStagePlaybook ? ' stage-playbook-detail' : ''}" data-section-id="${escapeHtml(section.id)}">
      <button class="detail-accordion-head" type="button" data-action="toggle-section" aria-expanded="${isOpen}">
        <span class="detail-accordion-title">${escapeHtml(section.title)}${countLabel}</span>
        <span class="detail-node-icon">${isOpen ? '-' : '+'}</span>
      </button>
      <div class="detail-accordion-body${isOpen ? '' : ' hidden'}">${content}</div>
    </section>
  `;
}

function renderDetailGroups(groups) {
  return `
    <div class="detail-group-list">
      ${groups.map((group) => `
        <section class="detail-group">
          <h4 class="detail-group-title">${escapeHtml(group.title)}</h4>
          <ul class="detail-group-items">${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </section>
      `).join('')}
    </div>
  `;
}

function bindInlineDetailEvents(container, node) {
  container.querySelectorAll('[data-action="toggle-section"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const sectionId = button.closest('[data-section-id]')?.dataset.sectionId;
      if (sectionId) toggleNodeSection(node.id, sectionId);
    });
  });
  container.querySelectorAll('[data-question]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      useSuggestedQuestion(button.dataset.question);
    });
  });
}

function toggleNodeSection(nodeId, sectionId) {
  const key = sectionKey(nodeId, sectionId);
  if (state.expandedSectionIds.has(key)) state.expandedSectionIds.delete(key);
  else state.expandedSectionIds.add(key);
  refreshOpenNodeDetailDialog(nodeId);
}

function toggleAllNodeSections(nodeId) {
  const node = currentSopNodes().find((item) => item.id === nodeId);
  if (!node) return;
  const keys = detailSectionsForNode(node).map((section) => sectionKey(nodeId, section.id));
  const allOpen = keys.length > 0 && keys.every((key) => state.expandedSectionIds.has(key));
  keys.forEach((key) => {
    if (allOpen) state.expandedSectionIds.delete(key);
    else state.expandedSectionIds.add(key);
  });
  refreshOpenNodeDetailDialog(nodeId);
}

function sectionKey(nodeId, sectionId) {
  return `${nodeId}:${sectionId}`;
}

function selectSopNode(nodeId) {
  const node = currentSopNodes().find((item) => item.id === nodeId);
  if (!node) return;

  const isDifferentNode = state.sopNodeId !== nodeId;
  state.sopNodeId = nodeId;
  state.expandedNodeIds.add(nodeId);
  if (isDifferentNode) collapseNodeSections(nodeId);
  state.selectedRecommendedQuestion = null;
  renderSopList();
  renderContext();
  renderComposerContext();
  renderConversationSuggestions();
  renderChat();
  openNodeDetailDialog(node.id);
  loadWorksheet(state.meetingType, node.stage, node.id, { userInput: '', attachments: [] });
}

function openNodeDetailDialog(nodeId, options = {}) {
  const node = currentSopNodes().find((item) => item.id === nodeId);
  if (!node) return;
  if (options.applyDefaultSections !== false) ensureDefaultDetailSectionsOpen(node);
  els.nodeDetailContent.innerHTML = renderNodeDetailDialogContent(node);
  bindNodeDetailDialogEvents(node);
  if (!els.nodeDetailDialog.open) showModal(els.nodeDetailDialog);
}

function ensureDefaultDetailSectionsOpen(node) {
  const availableSectionIds = new Set(detailSectionsForNode(node).map((section) => section.id));
  DEFAULT_OPEN_DETAIL_SECTIONS.forEach((sectionId) => {
    if (availableSectionIds.has(sectionId)) state.expandedSectionIds.add(sectionKey(node.id, sectionId));
  });
}

function refreshOpenNodeDetailDialog(nodeId) {
  if (!els.nodeDetailDialog.open) return;
  openNodeDetailDialog(nodeId, { applyDefaultSections: false });
}

function renderNodeDetailDialogContent(node) {
  const meeting = currentMeetingType();
  const warningNodes = incompletePreviousNodes(node.id);
  const warning = warningNodes.length
    ? `<div class="flow-warning"><strong>未完成前置节点</strong><span>${warningNodes.map((item) => `STEP ${padStep(item.step)} ${escapeHtml(item.title)}`).join('；')}</span></div>`
    : '';
  return `
    <div class="node-detail-head">
      <div>
        <div class="detail-kicker">STEP ${padStep(node.step)}</div>
        <h2>${escapeHtml(node.title)}</h2>
        <div class="node-detail-meta">
          <span>${escapeHtml(meeting ? `${meeting.id} 类 ${meeting.name}` : '未选择交流类型')}</span>
          <span>${escapeHtml(stageTitleForNode(node))}</span>
          <span>${state.completedNodeIds.has(node.id) ? '已完成' : '进行中'}</span>
        </div>
        <p>${escapeHtml(node.summary || '')}</p>
      </div>
      <div class="node-detail-tools">
        <button class="icon-button" type="button" data-action="toggle-all" title="全部展开/折叠" aria-label="全部展开/折叠">⇅</button>
        <button class="icon-button" type="button" data-action="close-node-detail" aria-label="关闭节点详情">×</button>
      </div>
    </div>
    ${warning}
    <div class="node-detail-actions">
      <button class="complete-node-button text" type="button" data-action="toggle-node-complete">${state.completedNodeIds.has(node.id) ? '标记为未完成' : '标记为已完成'}</button>
    </div>
    <div class="detail-accordion-list">
      ${detailSectionsForNode(node).map((section) => renderDetailAccordion(node, section)).join('')}
    </div>
  `;
}

function bindNodeDetailDialogEvents(node) {
  els.nodeDetailContent.querySelector('[data-action="close-node-detail"]')?.addEventListener('click', () => els.nodeDetailDialog.close());
  els.nodeDetailContent.querySelector('[data-action="toggle-all"]')?.addEventListener('click', () => toggleAllNodeSections(node.id));
  els.nodeDetailContent.querySelector('[data-action="toggle-node-complete"]')?.addEventListener('click', () => toggleNodeCompleted(node.id));
  bindInlineDetailEvents(els.nodeDetailContent, node);
}

function toggleNodeCompleted(nodeId) {
  if (state.completedNodeIds.has(nodeId)) state.completedNodeIds.delete(nodeId);
  else state.completedNodeIds.add(nodeId);
  renderSopList();
  renderContext();
  renderComposerContext();
  refreshOpenNodeDetailDialog(nodeId);
}

function incompletePreviousNodes(nodeId) {
  const nodes = currentSopNodes();
  const currentIndex = nodes.findIndex((item) => item.id === nodeId);
  if (currentIndex <= 0) return [];
  return nodes.slice(0, currentIndex).filter((item) => !state.completedNodeIds.has(item.id));
}

function collapseNodeSections(nodeId) {
  [...state.expandedSectionIds]
    .filter((key) => key.startsWith(nodeId + ':'))
    .forEach((key) => state.expandedSectionIds.delete(key));
}

function nodeStatus(node) {
  if (state.completedNodeIds.has(node.id)) return { label: '已完成', className: 'completed' };
  if (node.id === state.sopNodeId) return { label: '当前', className: 'active' };
  if (state.expandedNodeIds.has(node.id)) return { label: '已查看', className: 'viewed' };
  return { label: '未开始', className: '' };
}

function renderContext() {
  const node = currentNode();
  const meeting = currentMeetingType();
  const completion = contextCompletionLabel();
  const contextItems = [
    { label: '场景', value: state.scene.sceneName || '客户交流会议' },
    { label: '交流性质', value: meeting ? `${meeting.id} 类 ${meeting.name}` : '交流性质：未判断', warning: !meeting },
    { label: '当前节点', value: node ? `STEP ${padStep(node.step)} ${node.title}` : '未选择 SOP 节点' },
    { label: '客户信息', value: completion, warning: completion.includes('未选择') }
  ];
  els.contextStrip.innerHTML = contextItems.map((item) => {
    const className = item.warning ? 'context-chip warning' : 'context-chip';
    return '<span class="' + className + '"><b>' + escapeHtml(item.label) + '</b><strong>' + escapeHtml(item.value) + '</strong></span>';
  }).join('');
}

function renderComposerContext() {
  if (!els.composerContext) return;
  const meeting = currentMeetingType();
  const node = currentNode();
  if (!meeting || !node) {
    els.composerContext.textContent = '请选择交流类型和 SOP 节点后，AI 会按当前上下文回答。';
    els.composerContext.classList.add('warning');
    return;
  }
  els.composerContext.classList.remove('warning');
  els.composerContext.textContent = `将按 ${meeting.id} 类 / ${stageTitleForNode(node)} / STEP ${padStep(node.step)} ${node.title} 回答`;
}

function renderConversationSuggestions() {
  if (state.messages.length === 0) {
    els.conversationSuggestions.replaceChildren();
    return;
  }
  if (state.messages.some((message) => message.role === 'assistant')) {
    els.conversationSuggestions.replaceChildren();
    return;
  }
  const questions = questionsForCurrentNode('default', 2);
  if (!questions.length) {
    els.conversationSuggestions.replaceChildren();
    return;
  }
  const title = document.createElement('div');
  title.className = 'suggestion-title';
  title.textContent = '可以这样问 AI';
  const list = document.createElement('div');
  list.className = 'suggestion-list compact';
  questions.forEach((question) => list.appendChild(createSuggestionButton(question)));
  els.conversationSuggestions.replaceChildren(title, list);
}

function createSuggestionButton(question) {
  const wrap = document.createElement('div');
  wrap.className = 'suggestion-item compact';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'suggestion-text';
  button.textContent = question;
  button.addEventListener('click', () => useSuggestedQuestion(question));
  wrap.append(button);
  return wrap;
}

function appendRelatedQuestions(message) {
  message.relatedQuestions = questionsForCurrentNode('followup', 3);
  message.moreQuestions = questionsForCurrentNode('all', 12);
}

function renderRelatedQuestions(message) {
  const related = document.createElement('div');
  related.className = 'message-related';
  const list = document.createElement('div');
  list.className = 'suggestion-list compact';
  message.relatedQuestions.forEach((question) => list.appendChild(createSuggestionButton(question)));
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'more-trigger';
  more.textContent = '更多';
  more.addEventListener('click', () => openQuestionMoreDialog(message.moreQuestions));
  related.append(list, more);
  return related;
}

function questionsForCurrentNode(kind = 'default', limit = 3) {
  const nodeId = state.sopNodeId;
  const typeQuestions = state.questions?.byMeetingType?.[state.meetingType] || {};
  const nodeQuestions = [...((typeQuestions.bySopNode || {})[nodeId] || [])];
  const globalQuestions = [...(typeQuestions.globalQuestions || [])];
  const unique = [...new Set([...nodeQuestions, ...globalQuestions])].filter(Boolean);
  if (kind === 'followup') return unique.slice(1, limit + 1).length ? unique.slice(1, limit + 1) : unique.slice(0, limit);
  if (kind === 'all') return unique;
  return unique.slice(0, limit);
}

function taskIdForCurrentNode() {
  return stageIdForNode(currentNode());
}

function useSuggestedQuestion(question) {
  state.selectedRecommendedQuestion = question;
  els.userInput.value = question;
  autoResizeUserInput();
  els.userInput.focus();
  if (els.questionMoreDialog.open) els.questionMoreDialog.close();
  renderContext();
}

function autoResizeUserInput() {
  if (!els.userInput) return;
  els.userInput.style.height = 'auto';
  els.userInput.style.height = `${els.userInput.scrollHeight}px`;
}

function openQuestionMoreDialog(questions = questionsForCurrentNode('all', 12)) {
  const unique = [...new Set(questions && questions.length ? questions : questionsForCurrentNode('all', 12))].filter(Boolean);
  els.moreQuestionList.replaceChildren(...unique.map((question) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = question;
    button.addEventListener('click', () => useSuggestedQuestion(question));
    return button;
  }));
  showModal(els.questionMoreDialog);
}

function renderChat() {
  if (state.messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-chat-card';
    const questions = questionsForCurrentNode('default', 3);
    const title = document.createElement('strong');
    title.className = 'empty-chat-title';
    title.textContent = '可以这样问 AI';
    const list = document.createElement('div');
    list.className = 'suggestion-list compact';
    questions.forEach((question) => list.appendChild(createSuggestionButton(question)));
    empty.replaceChildren(title, list);
    els.chatLog.replaceChildren(empty);
    return;
  }
  els.chatLog.replaceChildren(...state.messages.map(renderMessage));
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function renderMessage(message) {
  const item = document.createElement('div');
  item.className = `message ${message.role}${message.loading ? ' loading' : ''}`;
  item.innerHTML = `<div class="message-label">${message.role === 'user' ? '你的输入' : message.role === 'error' ? '生成失败' : 'AI 建议'}</div><div class="message-body"></div>`;
  const body = item.querySelector('.message-body');
  if (message.loading && !message.content) body.innerHTML = '<span class="loading-dots" aria-label="加载中"><span></span><span></span><span></span></span>';
  else if (message.role === 'assistant') renderMarkdownContent(body, message.content);
  else body.textContent = message.content;
  if (message.role === 'assistant' && Array.isArray(message.relatedQuestions) && message.relatedQuestions.length) {
    item.appendChild(renderRelatedQuestions(message));
  }
  return item;
}

function renderMarkdownContent(container, content) {
  const fragment = document.createDocumentFragment();
  let activeList = null;
  let activeListType = '';
  let currentHeadingKey = '';
  let currentHeadingLevel = 0;

  normalizeOrderedListNumbering(content).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const heading = line.match(/^(#{1,4})\s+(.+)$/) || line.match(/^\*\*(.+?)\*\*[:：]?$/);
    if (heading) {
      activeList = null;
      activeListType = '';
      currentHeadingLevel = heading[1]?.startsWith('#') ? heading[1].length : 0;
      currentHeadingKey = heading[2] || heading[1];
      const div = document.createElement('div');
      div.className = 'markdown-line heading';
      div.innerHTML = formatInlineMarkdown(currentHeadingKey);
      fragment.appendChild(div);
      return;
    }

    const isStructuredHeadingContent = currentHeadingLevel >= 2;

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      activeList = appendSubheadingBulletItem(fragment, activeList, activeListType, bullet[1]);
      activeListType = 'ul';
      return;
    }

    const numbered = line.match(/^\d+[.)、]\s+(.+)$/);
    if (numbered) {
      if (isStructuredHeadingContent) {
        // 结构化标题下内容统一使用黑点列表，避免模型跳号或重复 1. 影响展示。
        activeList = appendSubheadingBulletItem(fragment, activeList, activeListType, numbered[1]);
        activeListType = 'ul';
        return;
      }
      if (!activeList || activeListType !== 'ol') {
        activeList = createMarkdownList('ol');
        activeList.dataset.headingKey = currentHeadingKey;
        fragment.appendChild(activeList);
      }
      activeListType = 'ol';
      const li = document.createElement('li');
      li.innerHTML = formatInlineMarkdown(numbered[1]);
      activeList.appendChild(li);
      return;
    }

    if (activeList && activeListType === 'ol' && appendParagraphToLastListItem(activeList, line)) return;

    if (isStructuredHeadingContent) {
      activeList = appendSubheadingBulletItem(fragment, activeList, activeListType, line);
      activeListType = 'ul';
      return;
    }

    activeList = null;
    activeListType = '';
    const div = document.createElement('div');
    div.className = 'markdown-line';
    div.innerHTML = formatInlineMarkdown(line);
    fragment.appendChild(div);
  });

  container.replaceChildren(fragment);
}

function createMarkdownList(type) {
  const list = document.createElement(type);
  list.className = 'markdown-list';
  return list;
}

function appendSubheadingBulletItem(fragment, activeList, activeListType, value) {
  let list = activeList;
  if (!list || activeListType !== 'ul') {
    list = createMarkdownList('ul');
    fragment.appendChild(list);
  }
  const li = document.createElement('li');
  li.innerHTML = formatInlineMarkdown(value);
  list.appendChild(li);
  return list;
}

function appendParagraphToLastListItem(activeList, line) {
  const lastItem = activeList.lastElementChild;
  if (!lastItem) return false;
  const div = document.createElement('div');
  div.className = 'markdown-list-note';
  div.innerHTML = formatInlineMarkdown(line);
  lastItem.appendChild(div);
  return true;
}

function normalizeOrderedListNumbering(content) {
  const lines = String(content || '').split('\n');
  const headingCountersByLevel = new Map();
  const parentHeadingNumbers = [];
  const listCountersByHeading = new Map();
  let currentHeadingKey = 'root';

  return lines.map((rawLine) => {
    const line = String(rawLine || '');
    const headingMatch = line.trim().match(/^(#{1,4})\s+([\d.]+)([.)、])\s+(.+)$/);
    if (headingMatch) {
      const normalized = normalizeHeadingNumber(headingMatch, headingCountersByLevel, parentHeadingNumbers);
      currentHeadingKey = normalized.replace(/^#+\s+/, '');
      listCountersByHeading.set(currentHeadingKey, 0);
      return normalized;
    }

    const numberedMatch = line.trim().match(/^(\d+)([.)、])\s+(.+)$/);
    if (numberedMatch) {
      const next = (listCountersByHeading.get(currentHeadingKey) || 0) + 1;
      listCountersByHeading.set(currentHeadingKey, next);
      return normalizeNumberedListItem(numberedMatch, next);
    }

    return line;
  });
}

function normalizeHeadingNumber(match, headingCountersByLevel, parentHeadingNumbers) {
  const hashes = match[1];
  const level = hashes.length;
  const title = match[4];
  const next = (headingCountersByLevel.get(level) || 0) + 1;
  headingCountersByLevel.set(level, next);

  for (const key of [...headingCountersByLevel.keys()]) {
    if (key > level) headingCountersByLevel.delete(key);
  }

  parentHeadingNumbers[level - 1] = next;
  parentHeadingNumbers.length = level;

  const number = level === 2
    ? String(next)
    : parentHeadingNumbers.slice(1, level).join('.');
  return `${hashes} ${number}. ${title}`;
}

function normalizeNumberedListItem(match, numberedListCounter) {
  return `${numberedListCounter}${match[2]} ${match[3]}`;
}

function formatInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$)/g, '$1<strong>$2</strong>')
    .replace(/\*\*/g, '')
    .replace(/(^|\s)\*/g, '$1');
}

function createModelHealthControls() {
  const section = document.createElement('section');
  section.className = 'model-health';
  section.setAttribute('aria-label', '模型服务检查');
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'modelHealthButton';
  button.textContent = '检查模型服务';
  const result = document.createElement('div');
  result.id = 'modelHealthResult';
  result.className = 'model-health-result';
  result.textContent = '未检查';
  section.append(button, result);
  els.modelHealthSlot.replaceChildren(section);
  els.modelHealthButton = button;
  els.modelHealthResult = result;
}

async function checkModelHealth() {
  els.modelHealthButton.disabled = true;
  els.modelHealthResult.className = 'model-health-result';
  els.modelHealthResult.textContent = '正在检查模型服务...';
  try {
    const response = await fetch('/api/customer-communication/model-health');
    const payload = await response.json();
    const base = `模型：${payload.model || '未知'} / 超时：${payload.timeoutMs || '-'}ms / 耗时：${payload.elapsedMs || '-'}ms`;
    if (response.ok && payload.ok) {
      els.modelHealthResult.textContent = `${base} / 状态：连接正常`;
      els.modelHealthResult.classList.add('ok');
      return;
    }
    els.modelHealthResult.textContent = `${base} / 状态：${userFacingErrorMessage(payload.errorMessage || '检查失败')}`;
    els.modelHealthResult.classList.add('error');
  } catch {
    els.modelHealthResult.textContent = '无法连接本地后端服务，请确认页面服务正在运行。';
    els.modelHealthResult.classList.add('error');
  } finally {
    els.modelHealthButton.disabled = false;
  }
}

async function handleAttachmentSelection() {
  const file = els.attachmentInput.files?.[0];
  if (!file) return;
  const readPromise = createAttachmentState(file, { parseDocx: parseDocxAttachment });
  state.attachment = { status: 'reading', fileName: file.name || '未命名文档', promise: readPromise };
  renderAttachmentChip();
  try {
    state.attachment = await readPromise;
    renderAttachmentChip();
  } catch (error) {
    state.attachment = { status: 'error', errorMessage: error.message || '文档读取失败，请重新选择。' };
    renderAttachmentChip();
    pushMessage('error', state.attachment.errorMessage);
  }
}

async function parseDocxAttachment(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/attachments/docx-text', { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.errorMessage || 'Word 文档解析失败，请重新选择。');
  return payload.text;
}

function renderAttachmentChip() {
  const attachment = state.attachment;
  const visible = attachment && attachment.status !== 'idle';
  els.attachmentChip.classList.toggle('hidden', !visible);
  els.attachmentChip.classList.toggle('is-reading', visible && attachment.status === 'reading');
  els.attachmentChip.classList.toggle('is-error', visible && attachment.status === 'error');
  els.composer.querySelector('.composer-input-shell')?.classList.toggle('has-attachment', visible);
  if (!visible) {
    els.attachmentName.textContent = '';
    return;
  }
  if (attachment.status === 'reading') {
    els.attachmentName.textContent = `${attachment.fileName || '文档'} · 读取中...`;
    return;
  }
  if (attachment.status === 'error') {
    els.attachmentName.textContent = '文档读取失败，请重新选择';
    return;
  }
  els.attachmentName.textContent = attachment.fileName || '已选择文档';
}

function clearAttachment() {
  state.attachment = EMPTY_ATTACHMENT_STATE;
  els.attachmentInput.value = '';
  renderAttachmentChip();
}

async function snapshotAttachment() {
  return resolveAttachmentSnapshotForSend(state.attachment);
}

async function sendMessage() {
  if (state.isGenerating) {
    stopCurrentGeneration();
    return;
  }
  const userInput = els.userInput.value.trim();
  let attachmentSnapshot;
  try {
    attachmentSnapshot = await snapshotAttachment();
  } catch (error) {
    pushMessage('error', error.message || '文档读取失败，请重新选择。');
    return;
  }
  const messageInput = userInput || (attachmentSnapshot ? DEFAULT_ATTACHMENT_PROMPT : '');
  if (!messageInput) {
    pushMessage('error', '请输入问题，或先上传文档。');
    return;
  }
  await requestStepRecommendation(messageInput, attachmentSnapshot);
}

async function requestStepRecommendation(userInput, attachmentSnapshot) {
  const response = await fetch(`/api/scenes/${state.sceneId}/steps/recommend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userInput, attachments: attachmentRequestPayload(attachmentSnapshot) }) });
  const payload = await response.json(); const recommendation = payload.recommendation;
  if (!recommendation?.sopNodeId) return pushMessage('error', recommendation?.reason || '未能识别具体步骤，请从左侧 SOP 选择。');
  state.worksheetSource = { userInput, attachments: attachmentRequestPayload(attachmentSnapshot) };
  renderStepConfirmation(recommendation);
}

function renderStepConfirmation(recommendation) {
  state.pendingStepRecommendation = { ...recommendation };
  renderPendingStepControls();
}

function renderPendingStepControls() {
  const pending = state.pendingStepRecommendation;
  if (!pending) return;
  const type = state.scene.meetingTypes.find((item) => item.id === pending.meetingType);
  const nodes = (type?.sopNodes || []).filter((node) => node.stage === pending.stage);
  els.stepConfirmation.innerHTML = `<strong>识别结果，请确认</strong><p>${escapeHtml(pending.reason || '')}</p><label>会议类型<select id="confirmType">${state.scene.meetingTypes.map((item) => `<option value="${item.id}"${item.id === pending.meetingType ? ' selected' : ''}>${item.id} 类 ${escapeHtml(item.name)}</option>`).join('')}</select></label><label>当前阶段<select id="confirmStage">${STAGE_DEFS.map((item) => `<option value="${item.id}"${item.id === pending.stage ? ' selected' : ''}>${item.title}</option>`).join('')}</select></label><label>步骤<select id="confirmNode">${nodes.map((node) => `<option value="${node.id}"${node.id === pending.sopNodeId ? ' selected' : ''}>${escapeHtml(node.title)}</option>`).join('')}</select></label><button type="button" id="confirmStep">确认并生成工作表</button>`;
  els.stepConfirmation.querySelector('#confirmType').addEventListener('change', (event) => updatePendingStepSelection({ meetingType: event.target.value }));
  els.stepConfirmation.querySelector('#confirmStage').addEventListener('change', (event) => updatePendingStepSelection({ stage: event.target.value }));
  els.stepConfirmation.querySelector('#confirmNode').addEventListener('change', (event) => { state.pendingStepRecommendation.sopNodeId = event.target.value; });
  els.stepConfirmation.querySelector('#confirmStep').addEventListener('click', async () => {
    const selected = state.pendingStepRecommendation;
    await loadWorksheet(selected.meetingType, selected.stage, selected.sopNodeId, state.worksheetSource);
  });
}

function updatePendingStepSelection(changes) {
  const next = { ...state.pendingStepRecommendation, ...changes };
  const type = state.scene.meetingTypes.find((item) => item.id === next.meetingType);
  const availableNodes = (type?.sopNodes || []).filter((node) => node.stage === next.stage);
  if (!availableNodes.some((node) => node.id === next.sopNodeId)) next.sopNodeId = availableNodes[0]?.id || '';
  state.pendingStepRecommendation = next;
  renderPendingStepControls();
}

async function loadWorksheet(meetingType, stage, sopNodeId, source = { userInput: '', attachments: [] }) {
  const response = await fetch(`/api/scenes/${state.sceneId}/steps/worksheet`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingType, stage, sopNodeId, userInput: source.userInput, attachments: source.attachments }) });
  const payload = await response.json(); const worksheet = payload.worksheet;
  if (!response.ok || !worksheet) return pushMessage('error', payload.errorMessage || '工作表生成失败。');
  state.meetingType = meetingType; state.sopNodeId = sopNodeId;
  state.currentWorksheet = worksheet;
  state.pendingStepRecommendation = null;
  els.stepConfirmation.replaceChildren();
  els.worksheet.classList.remove('hidden');
  const warning = payload.extractionWarning ? `<p class="worksheet-warning">${escapeHtml(payload.extractionWarning)}</p>` : '';
  els.worksheet.innerHTML = `<div class="worksheet-head"><h2>${escapeHtml(worksheet.title)}</h2><button type="button" id="exportDocxButton">导出 Word</button></div>${warning}${worksheet.fields.map((field, index) => `<label>${escapeHtml(field.label)}<small>${escapeHtml(field.source)}</small><textarea data-field="${index}">${escapeHtml(field.value)}</textarea></label>`).join('')}<h3>风险与边界</h3><ul>${worksheet.risks.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  renderAll();
}

async function sendTaskRequest(userInput, attachmentSnapshot = null) {
  const assistantMessage = appendAssistantMessage('');
  pushMessage('user', userInput);
  const controller = new AbortController();
  state.currentAbortController = controller;
  setLoading(true);
  try {
    const response = await fetch(`/api/scenes/${state.sceneId}/tasks/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ userInput, taskId: state.selectedTaskId, meetingType: state.meetingType || undefined, attachments: attachmentRequestPayload(attachmentSnapshot), conversationHistory: recentConversationHistory() }) });
    if (!response.ok) throw new Error('生成失败');
    await readTaskStream(response, assistantMessage);
    if (state.latestTaskResult && state.selectedTaskId === 'after_meeting') els.exportDocxButton.disabled = false;
  } catch (error) {
    updateMessageContent(assistantMessage, error.message || '生成失败，请稍后重试。', 'error');
  } finally {
    state.currentAbortController = null;
    setLoading(false);
    clearAttachment();
  }
}

async function readTaskStream(response, message) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split('\n\n'); buffer = events.pop() || ''; for (const eventText of events) { const event = eventText.match(/^event: (.+)$/m)?.[1]; const raw = eventText.match(/^data: (.+)$/m)?.[1]; if (!event || !raw) continue; const payload = JSON.parse(raw); if (event === 'delta') updateMessageContent(message, `${message.content || ''}${payload.content}`); if (event === 'clarification') updateMessageContent(message, payload.question); if (event === 'context') els.taskContext.textContent = `当前判断：${payload.meetingType} 类 / ${payload.stage}`; } }
  state.latestTaskResult = message.content || '';
}

async function exportLatestReview() {
  if (!state.currentWorksheet) return pushMessage('error', '请先确认 SOP 步骤并生成工作表。');
  const worksheet = {
    ...state.currentWorksheet,
    fields: state.currentWorksheet.fields.map((field, index) => ({
      ...field,
      value: els.worksheet.querySelector(`[data-field="${index}"]`)?.value.trim() || '待确认'
    }))
  };
  const response = await fetch(`/api/scenes/${state.sceneId}/tasks/export-docx`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worksheet }) });
  if (!response.ok) return pushMessage('error', '工作表导出失败，请稍后重试。');
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `${worksheet.title}.docx`; link.click(); URL.revokeObjectURL(url);
}

async function maybeConfirmCustomerContextSync(userInput, attachmentSnapshot = null) {
  const candidates = extractCustomerContextCandidates(userInput);
  if (!candidates.length) return false;
  state.pendingCustomerSync = { userInput, candidates, attachmentSnapshot };
  renderCustomerSyncDialog(candidates);
  showModal(els.customerSyncDialog);
  return true;
}

function extractCustomerContextCandidates(userInput) {
  const type = currentMeetingTypeConfig();
  if (!type) return [];
  const fieldById = new Map(type.intakeSchema.map((field) => [field.id, field]));
  const candidates = customerContextExtractionRules()
    .filter((rule) => fieldById.has(rule.fieldId))
    .map((rule) => {
      const value = extractValueByKeywords(userInput, rule.keywords) || extractValueByPatterns(userInput, rule.patterns);
      if (!value) return null;
      const field = fieldById.get(rule.fieldId);
      return {
        fieldId: rule.fieldId,
        label: field.label,
        value,
        currentValue: String(state.customerContext[rule.fieldId] || '').trim()
      };
    })
    .filter(Boolean);
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.fieldId)) return false;
    seen.add(candidate.fieldId);
    return true;
  });
}

function customerContextExtractionRules() {
  return [
    { fieldId: 'customerName', keywords: ['客户单位', '客户名称', '客户', '单位名称'], patterns: [/客户是\s*(.+)$/i, /客户为\s*(.+)$/i] },
    { fieldId: 'mainBusiness', keywords: ['主营业务', '主要业务', '业务'], patterns: [/主要做\s*(.+)$/i, /主要从事\s*(.+)$/i, /主营\s*(.+)$/i] },
    { fieldId: 'meetingBackground', keywords: ['本次交流背景', '交流背景', '会议背景', '沟通背景'], patterns: [/本次(?:交流|沟通|会议)背景是\s*(.+)$/i] },
    { fieldId: 'participantLevel', keywords: ['参会人员及最高层级', '参会最高层级', '最高层级', '参会人员', '参会人'], patterns: [/参会(?:人员|人).*?(?:最高层级)?是\s*(.+)$/i] },
    { fieldId: 'existingSystems', keywords: ['已有系统', '现有系统', '系统建设'], patterns: [/已有系统是\s*(.+)$/i, /现有系统是\s*(.+)$/i] },
    { fieldId: 'departmentOrScenario', keywords: ['对接科室或业务场景', '对接科室', '业务场景', '科室', '场景'], patterns: [/对接(?:科室|部门)是\s*(.+)$/i, /业务场景是\s*(.+)$/i] },
    { fieldId: 'decisionOwner', keywords: ['决策者或负责人', '决策者', '负责人', '关键人'], patterns: [/关键人是\s*(.+)$/i, /决策者是\s*(.+)$/i, /负责人是\s*(.+)$/i] },
    { fieldId: 'budgetIntent', keywords: ['预算或采购意愿', '预算意愿', '采购意愿', '预算', '采购'], patterns: [/预算(?:或采购)?意愿是\s*(.+)$/i, /是否有预算(?:意愿)?[:：是为\s]*(.+)$/i] },
    { fieldId: 'customerConcern', keywords: ['客户当前态度或主要顾虑', '客户态度', '主要顾虑', '顾虑', '态度'], patterns: [/客户(?:当前)?(?:态度|顾虑)是\s*(.+)$/i] },
    { fieldId: 'meetingGoal', keywords: ['本次交流目标或需要推动的结果', '本次交流目标', '交流目标', '需要推动的结果', '推动结果'] },
    { fieldId: 'reportGoal', keywords: ['汇报目标', '本次汇报目标'] },
    { fieldId: 'demoTopic', keywords: ['Demo / 方案主题', 'Demo主题', 'Demo 主题', '方案主题', '演示主题'], patterns: [/Demo(?:\s*\/\s*方案)?主题是\s*(.+)$/i, /方案主题是\s*(.+)$/i] },
    { fieldId: 'expectedOutput', keywords: ['本次汇报预期产出', '预期产出', '产出结果', '本次汇报产出'] },
    { fieldId: 'customerFocus', keywords: ['客户重点关注问题', '重点关注问题', '客户关注问题', '关注问题'] },
    { fieldId: 'nextStepGoal', keywords: ['汇报后推进目标', '期望汇报后的下一步结果', '下一步结果', '会后推进目标', '推进目标'] }
  ];
}

function extractValueByKeywords(userInput, keywords) {
  const text = String(userInput || '').replace(/\r/g, '\n');
  const parts = text.split(/[\n，,；;]/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    for (const keyword of keywords) {
      const pattern = new RegExp('^' + escapeRegExp(keyword) + '\\s*(?:是|为|:|：|=|-)\\s*(.+)$', 'i');
      const match = part.match(pattern);
      const value = cleanExtractedCustomerValue(match?.[1]);
      if (value) return value;
    }
  }
  return '';
}

function extractValueByPatterns(userInput, patterns) {
  if (!patterns?.length) return '';
  const text = String(userInput || '').replace(/\r/g, '\n');
  const parts = text.split(/[\n，,；;]/).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    for (const pattern of patterns) {
      const match = part.match(pattern);
      const value = cleanExtractedCustomerValue(match?.[1]);
      if (value) return value;
    }
  }
  return '';
}

function cleanExtractedCustomerValue(value) {
  return String(value || '').trim().replace(/[。.!！?？]+$/, '').slice(0, 120);
}

function renderCustomerSyncDialog(candidates) {
  els.customerSyncFields.replaceChildren(...candidates.map((candidate) => {
    const label = document.createElement('label');
    label.className = 'customer-sync-field';
    const checked = !candidate.currentValue;
    label.innerHTML = `
      <input type="checkbox" data-field-id="${escapeHtml(candidate.fieldId)}"${checked ? ' checked' : ''}>
      <span class="customer-sync-text">
        <strong>${escapeHtml(candidate.label)}</strong>
        ${candidate.currentValue ? `<small>当前：${escapeHtml(candidate.currentValue)}</small>` : '<small>当前为空</small>'}
        <em>识别：${escapeHtml(candidate.value)}</em>
      </span>
    `;
    return label;
  }));
}

async function confirmCustomerSyncAndSend() {
  const pending = state.pendingCustomerSync;
  if (!pending) return;
  const selectedFieldIds = new Set([...els.customerSyncFields.querySelectorAll('input:checked')].map((input) => input.dataset.fieldId));
  pending.candidates.forEach((candidate) => {
    if (selectedFieldIds.has(candidate.fieldId)) state.customerContext[candidate.fieldId] = candidate.value;
  });
  const userInput = pending.userInput;
  state.pendingCustomerSync = null;
  els.customerSyncDialog.close();
  renderContext();
  renderIntakeFields();
  await sendMessageAfterCustomerSync(userInput, pending.attachmentSnapshot);
}

async function continueWithoutCustomerSync() {
  const pending = state.pendingCustomerSync;
  if (!pending) {
    els.customerSyncDialog.close();
    return;
  }
  state.pendingCustomerSync = null;
  els.customerSyncDialog.close();
  await sendMessageAfterCustomerSync(pending.userInput, pending.attachmentSnapshot);
}

async function sendMessageAfterCustomerSync(userInput, attachmentSnapshot = null) {
  const conversationHistory = recentConversationHistory();
  pushMessage('user', userInput);
  const assistantMessage = appendAssistantMessage('');
  const controller = new AbortController();
  state.currentAbortController = controller;
  els.userInput.value = '';
  autoResizeUserInput();
  setLoading(true);
  let stoppedByUser = false;
  try {
    const response = await fetch(`/api/scenes/${state.sceneId}/chat-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        meetingType: state.meetingType,
        customerContext: state.customerContext,
        taskId: taskIdForCurrentNode(),
        sopNodeId: state.sopNodeId,
        completedNodeIds: [...state.completedNodeIds],
        incompletePreviousNodeIds: incompletePreviousNodes(state.sopNodeId).map((node) => node.id),
        currentDetailNodeId: null,
        selectedRecommendedQuestion: state.selectedRecommendedQuestion,
        conversationHistory,
        attachments: attachmentRequestPayload(attachmentSnapshot),
        userInput
      })
    });
    if (!response.ok) {
      updateMessageContent(assistantMessage, '生成失败，请稍后重试。', 'error');
      return;
    }
    await readSseStream(response, (event, payload) => handleSseEvent(event, payload, assistantMessage));
    if (controller.signal.aborted) {
      stoppedByUser = true;
      if (!assistantMessage.content) updateMessageContent(assistantMessage, '已停止生成。');
      return;
    }
    appendRelatedQuestions(assistantMessage);
    renderChat();
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      stoppedByUser = true;
      if (!assistantMessage.content) updateMessageContent(assistantMessage, '已停止生成。');
      return;
    }
    updateMessageContent(assistantMessage, '网络异常，请检查服务是否正在运行。', 'error');
  } finally {
    if (state.currentAbortController === controller) state.currentAbortController = null;
    setLoading(false);
    clearAttachment();
    if (!stoppedByUser) renderConversationSuggestions();
  }
}

function stopCurrentGeneration() {
  state.currentAbortController?.abort();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function handleSseEvent(event, payload, message) {
  if (event === 'delta') updateMessageContent(message, message.content + (payload.content || ''));
  if (event === 'error') updateMessageContent(message, userFacingErrorMessage(payload.errorMessage || '生成失败，请稍后重试。'), 'error');
}

function userFacingErrorMessage(message) {
  if (message === '模型超过等待时间未返回结果。请稍后重试，或将 MODEL_TIMEOUT_MS 调大后重启服务。') {
    return '模型响应超时，请稍后重试或联系管理员检查服务。';
  }
  return message;
}

function pushMessage(role, content) {
  state.messages.push({ role, content });
  renderChat();
}

function appendAssistantMessage(content) {
  const message = { role: 'assistant', content, relatedQuestions: [], moreQuestions: [], loading: true };
  state.messages.push(message);
  renderChat();
  return message;
}

function updateMessageContent(message, content, role = message.role) {
  message.content = content;
  message.role = role;
  if (role === 'error' || content) message.loading = false;
  renderChat();
}

function recentConversationHistory() {
  return state.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content }));
}

function setLoading(isLoading) {
  state.isGenerating = isLoading;
  els.sendButton.disabled = false;
  els.attachButton.disabled = isLoading;
  els.sendButton.classList.toggle('is-stopping', isLoading);
  els.sendButton.setAttribute('aria-label', isLoading ? '停止生成' : '生成');
  els.sendButton.setAttribute('title', isLoading ? '停止生成' : '生成');
  els.sendButton.innerHTML = isLoading ? '<span class="stop-icon" aria-hidden="true"></span>' : '生成';
  if (!isLoading) renderComposerContext();
}

function closeDialogOnBackdrop(event) {
  if (event.target === event.currentTarget) event.currentTarget.close();
}

function showModal(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function currentMeetingType() {
  return state.scene.meetingTypes.find((item) => item.id === state.meetingType);
}

function currentNode() {
  return currentSopNodes().find((item) => item.id === state.sopNodeId);
}

function contextCompletionLabel() {
  const type = currentMeetingTypeConfig();
  if (!type) return '未选择交流类型';
  const total = type.intakeSchema.length;
  const filled = type.intakeSchema.filter((field) => String(state.customerContext[field.id] || '').trim()).length;
  const customerName = String(state.customerContext.customerName || '').trim();
  return customerName ? `${customerName} · 客户信息 ${filled}/${total}` : `客户信息 ${filled}/${total}`;
}

function formatResources(resources) {
  if (!Array.isArray(resources)) return [];
  return resources.map((item) => `${item.title || item.id || '资料入口'}：${item.displayRule || item.status || '可在后续补充'}`);
}

function padStep(step) {
  return String(step || '').padStart(2, '0');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderFatalError(error) {
  document.body.innerHTML = `<main class="fatal"><h1>页面加载失败</h1><p>${escapeHtml(error.message)}</p></main>`;
}














