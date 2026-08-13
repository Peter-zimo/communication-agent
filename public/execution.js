import { readSseStream } from './sse.js';

const state = {
  stage: 'before',
  meetingType: '',
  config: null,
  session: { customerName: '', background: '', selections: {}, materials: {}, keyItems: {}, records: [] },
  attachment: null,
  workspace: null,
  documents: null,
  activeDocument: 'minutes',
  selectedRecordType: 'quote',
  battleCardOptimization: { status: 'idle', content: '', errorMessage: '', startedAt: 0, elapsedSeconds: 0 },
  battleCardDraft: null,
  battleCardProposal: null,
  battleCardRevision: 0,
  lastAppliedBattleCardDraft: null,
  lastAppliedMaterials: null,
  lastApplySummary: '',
  battleCardAbortController: null,
  battleCardTimer: null
};

const els = {
  view: document.querySelector('#executionView'),
  back: document.querySelector('#executionBackButton'),
  modelHealthSlot: document.querySelector('#executionModelHealthSlot'),
  modelHealthButton: null,
  modelHealthResult: null,
  stageLabel: document.querySelector('#executionStageLabel'),
  stepNav: document.querySelector('#executionStepNav'),
  before: document.querySelector('#beforeExecutionStage'),
  during: document.querySelector('#duringExecutionStage'),
  after: document.querySelector('#afterExecutionStage'),
  types: document.querySelector('#executionMeetingTypes'),
  afterTypes: document.querySelector('#afterMeetingTypes'),
  customerName: document.querySelector('#executionCustomerName'),
  background: document.querySelector('#executionMeetingBackground'),
  quickFields: document.querySelector('#executionQuickFields'),
  generateCard: document.querySelector('#generateBattleCardButton'),
  battleCard: document.querySelector('#battleCard'),
  duringSummary: document.querySelector('#duringSummary'),
  duringProgress: document.querySelector('#duringProgress'),
  liveQuestions: document.querySelector('#liveQuestions'),
  liveKeyItems: document.querySelector('#liveKeyItems'),
  recordTypes: document.querySelector('#liveRecordTypes'),
  recordText: document.querySelector('#liveRecordText'),
  recordConfirmed: document.querySelector('#liveRecordConfirmed'),
  addRecord: document.querySelector('#addLiveRecordButton'),
  recordList: document.querySelector('#liveRecordList'),
  goToAfter: document.querySelector('#goToAfterButton'),
  source: document.querySelector('#executionSource'),
  sourceState: document.querySelector('#executionSourceState'),
  fileInput: document.querySelector('#executionFileInput'),
  fileName: document.querySelector('#executionFileName'),
  extract: document.querySelector('#extractMeetingButton'),
  typeSource: document.querySelector('#meetingTypeSource'),
  factEmpty: document.querySelector('#factEmpty'),
  factList: document.querySelector('#factList'),
  factSummary: document.querySelector('#factSummary'),
  gapSummary: document.querySelector('#gapSummary'),
  generate: document.querySelector('#generateDocumentsButton'),
  tabs: document.querySelector('#documentTabs'),
  preview: document.querySelector('#documentPreview'),
  outputActions: document.querySelector('#outputActions'),
  downloadMarkdown: document.querySelector('#downloadMarkdownButton'),
  downloadWord: document.querySelector('#downloadWordButton')
};

if (els.view) init().catch((error) => setInputMessage(error.message || '会议执行助手加载失败。', true));

async function init() {
  const response = await fetch('/api/scenes/customer_communication/config');
  if (!response.ok) throw new Error('会议执行配置加载失败。');
  const payload = await response.json();
  state.config = payload.executionConfig;
  createModelHealthControls();
  bindEvents();
  renderAll();
}

function bindEvents() {
  els.back.addEventListener('click', () => {
    els.view.classList.add('hidden');
    document.querySelector('#homeView')?.classList.remove('hidden');
  });
  els.modelHealthButton.addEventListener('click', checkModelHealth);
  els.stepNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-stage]');
    if (button) setStage(button.dataset.stage);
  });
  bindTypeSelector(els.types);
  bindTypeSelector(els.afterTypes);
  els.customerName.addEventListener('input', () => { state.session.customerName = els.customerName.value; touchBattleCardDraft(); });
  els.background.addEventListener('input', () => { state.session.background = els.background.value; touchBattleCardDraft(); });
  els.quickFields.addEventListener('click', handleQuickOption);
  els.quickFields.addEventListener('input', handleQuickText);
  els.generateCard.addEventListener('click', generateBattleCard);
  els.battleCard.addEventListener('click', handleBattleCardAction);
  els.battleCard.addEventListener('change', handleBattleCardChange);
  els.liveQuestions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-question]');
    if (button) els.recordText.value = button.dataset.question;
  });
  els.liveKeyItems.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-key-item]');
    if (!checkbox) return;
    state.session.keyItems[checkbox.dataset.keyItem] = checkbox.checked;
    renderDuring();
  });
  els.recordTypes.addEventListener('click', (event) => {
    const button = event.target.closest('[data-record-type]');
    if (!button) return;
    state.selectedRecordType = button.dataset.recordType;
    renderRecordTypes();
  });
  els.addRecord.addEventListener('click', addLiveRecord);
  els.recordList.addEventListener('click', handleRecordAction);
  els.goToAfter.addEventListener('click', prepareAfterMeeting);
  els.fileInput.addEventListener('change', handleFile);
  els.extract.addEventListener('click', extractMeeting);
  els.factList.addEventListener('click', handleFactAction);
  els.factList.addEventListener('input', handleFactEdit);
  els.generate.addEventListener('click', generateDocuments);
  els.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-document]');
    if (!button) return;
    state.activeDocument = button.dataset.document;
    renderDocument();
  });
  els.preview.addEventListener('input', () => {
    if (!state.documents) return;
    state.documents[state.activeDocument === 'minutes' ? 'minutesMarkdown' : 'followUpMarkdown'] = els.preview.value;
  });
  els.downloadMarkdown.addEventListener('click', downloadMarkdown);
  els.downloadWord.addEventListener('click', downloadWord);
}

function createModelHealthControls() {
  const section = document.createElement('section');
  section.className = 'model-health execution-model-health';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '检查模型服务';
  const result = document.createElement('div');
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
  els.modelHealthResult.textContent = '正在检查模型服务…';
  try {
    const response = await fetch('/api/customer-communication/model-health');
    const payload = await response.json();
    const summary = `模型：${payload.model || '未知'} / 耗时：${payload.elapsedMs || '-'}ms`;
    if (response.ok && payload.ok) {
      els.modelHealthResult.textContent = `${summary} / 连接正常`;
      els.modelHealthResult.classList.add('ok');
      return;
    }
    els.modelHealthResult.textContent = `${summary} / ${payload.errorMessage || '检查失败'}`;
    els.modelHealthResult.classList.add('error');
  } catch {
    els.modelHealthResult.textContent = '无法连接本地后端服务。';
    els.modelHealthResult.classList.add('error');
  } finally {
    els.modelHealthButton.disabled = false;
  }
}

function bindTypeSelector(container) {
  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-type]');
    if (button) selectMeetingType(button.dataset.type);
  });
}

function renderAll() {
  renderStage();
  renderTypes();
  renderQuickFields();
  renderDuring();
  renderFacts();
}

function setStage(stage) {
  if (!['before', 'during', 'after'].includes(stage)) return;
  state.stage = stage;
  renderStage();
}

function renderStage() {
  const stageTitle = { before: '会前', during: '会中', after: '会后' }[state.stage];
  els.stageLabel.textContent = stageTitle;
  els.before.classList.toggle('hidden', state.stage !== 'before');
  els.during.classList.toggle('hidden', state.stage !== 'during');
  els.after.classList.toggle('hidden', state.stage !== 'after');
  els.stepNav.querySelectorAll('[data-stage]').forEach((button) => button.classList.toggle('active', button.dataset.stage === state.stage));
}

function selectMeetingType(type) {
  const changed = state.meetingType && state.meetingType !== type;
  state.meetingType = type;
  if (changed) {
    state.session = { customerName: state.session.customerName, background: state.session.background, selections: {}, materials: {}, keyItems: {}, records: [] };
    state.workspace = null;
    clearDocuments();
  }
  resetBattleCardDraft();
  stopBattleCardOptimization({ keepResult: false });
  renderAll();
}

function typeConfig() { return state.config?.byMeetingType?.[state.meetingType]; }

function renderTypes() {
  [els.types, els.afterTypes].forEach((container) => {
    container.querySelectorAll('[data-type]').forEach((button) => button.classList.toggle('active', button.dataset.type === state.meetingType));
  });
  els.typeSource.textContent = state.meetingType ? `${state.meetingType} 类已选择` : '待选择';
}

function renderQuickFields() {
  const config = typeConfig();
  if (!config) {
    els.quickFields.innerHTML = '<p class="execution-empty">请选择 A / B / C 会议类型，系统会显示对应的快捷选项。</p>';
    return;
  }
  els.quickFields.replaceChildren(...config.quickFields.map((field) => {
    const section = document.createElement('section');
    const selected = new Set(state.session.selections[field.id] || []);
    section.className = 'quick-field';
    section.innerHTML = `<h3>${escapeHtml(field.label)}</h3><div class="choice-chips">${field.options.map((option) => `<button type="button" class="choice-chip${selected.has(option) ? ' active' : ''}" data-field="${escapeHtml(field.id)}" data-option="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join('')}</div><input data-quick-text="${escapeHtml(field.id)}" value="${escapeHtml(state.session.selections[`${field.id}_custom`] || '')}" placeholder="没有合适选项可补充填写">`;
    return section;
  }));
}

function handleQuickOption(event) {
  const button = event.target.closest('[data-field][data-option]');
  if (!button) return;
  const values = new Set(state.session.selections[button.dataset.field] || []);
  values.has(button.dataset.option) ? values.delete(button.dataset.option) : values.add(button.dataset.option);
  state.session.selections[button.dataset.field] = [...values];
  touchBattleCardDraft();
  renderQuickFields();
}

function handleQuickText(event) {
  const input = event.target.closest('[data-quick-text]');
  if (!input) return;
  state.session.selections[`${input.dataset.quickText}_custom`] = input.value;
  touchBattleCardDraft();
}

function generateBattleCard() {
  if (!state.meetingType) return setInputMessage('请先选择 A / B / C 会议类型。', true);
  if (!els.customerName.value.trim() || !els.background.value.trim()) return setInputMessage('请填写客户名称和会议背景；不清楚时可填写“待确认”。', true);
  state.session.customerName = els.customerName.value.trim();
  state.session.background = els.background.value.trim();
  state.battleCardDraft = createBattleCardDraft(typeConfig());
  state.battleCardProposal = null;
  state.lastAppliedBattleCardDraft = null;
  state.lastAppliedMaterials = null;
  state.lastApplySummary = '';
  state.battleCardRevision += 1;
  state.battleCardOptimization = { status: 'idle', content: '', errorMessage: '', startedAt: 0, elapsedSeconds: 0 };
  els.battleCard.classList.remove('hidden');
  renderBattleCard();
  setInputMessage('已根据当前 SOP 生成会前作战卡。');
}

function renderBattleCard() {
  const config = typeConfig();
  if (!config) return;
  const draft = state.battleCardDraft || createBattleCardDraft(config);
  const optimization = state.battleCardOptimization;
  const isGenerating = ['connecting', 'generating'].includes(optimization.status);
  const buttonLabel = isGenerating ? '停止生成' : optimization.status === 'idle' ? 'AI 优化作战卡' : '重新生成';
  const statusText = battleCardStatusText(optimization);
  const resultText = optimization.errorMessage || state.lastApplySummary || '点击“AI 优化作战卡”，DeepSeek 会生成可逐项采纳的候选方案。';
  els.battleCard.innerHTML = `
    <div class="battle-card-head"><div><span>作战卡</span><h2>${escapeHtml(state.session.customerName || '待确认客户')} · ${state.meetingType} 类会议</h2><p>${escapeHtml(state.session.background || '请补充会议背景')}</p></div><button id="optimizeBattleCardButton" type="button"${isGenerating ? ' class="is-generating"' : ''}>${buttonLabel}</button></div>
    <section><h3>会议目标</h3><p>${escapeHtml(draft.meetingGoal)}</p></section>
    <section><h3>会议结束前必须拿到</h3><ul>${config.successItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
    <section><h3>优先问题</h3><div class="quick-question-list">${draft.priorityQuestions.map((question) => `<button type="button" data-card-question="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join('')}</div></section>
    <section><h3>材料与检查项</h3><div class="check-list">${draft.materials.map((item) => `<label><input type="checkbox" data-material="${escapeHtml(item)}" ${state.session.materials[item] ? 'checked' : ''}>${escapeHtml(item)}</label>`).join('')}</div></section>
    <section class="guardrail-card"><h3>边界提醒</h3><ul>${[...config.guardrails, ...draft.riskReminders].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
    ${renderBattleCardProposal(draft)}
    <section class="ai-optimization ${optimization.status}" id="battleCardOptimization" aria-live="polite"><div class="ai-optimization-head"><h3>AI 优化建议</h3><span>${escapeHtml(statusText)}</span></div><p>${escapeHtml(resultText).replace(/\n/g, '<br>')}</p></section>`;
}

function renderBattleCardProposal(draft) {
  const candidate = state.battleCardProposal;
  if (!candidate) return state.lastAppliedBattleCardDraft ? '<section class="battle-card-apply-result"><span>已应用 AI 候选方案。</span><button type="button" data-battle-card-action="undo">撤销本次应用</button></section>' : '';
  if (candidate.status === 'stale') return '<section class="battle-card-proposal stale"><h3>AI 候选方案已过期</h3><p>作战卡或会议输入已在生成期间变更。请重新生成，避免应用过期建议。</p><div><button type="button" data-battle-card-action="discard">保留当前作战卡</button></div></section>';
  const proposal = candidate.proposal;
  const sections = [
    ['meetingGoal', '会议目标', [draft.meetingGoal], [proposal.meetingGoal]],
    ['priorityQuestions', '优先追问', draft.priorityQuestions, proposal.priorityQuestions],
    ['materials', '建议携带材料', draft.materials, proposal.materials],
    ['riskReminders', '补充风险提醒', draft.riskReminders.length ? draft.riskReminders : ['暂无'], proposal.riskReminders]
  ];
  return `<section class="battle-card-proposal" aria-live="polite"><div class="battle-card-proposal-head"><div><h3>AI 候选方案</h3><p>固定 SOP 必做项和边界提醒不会被替换。</p></div><div><button type="button" data-battle-card-action="select-all">全选</button><button type="button" data-battle-card-action="clear-selection">清空</button></div></div>${sections.map(([key, label, current, suggested]) => `<article><label class="proposal-select"><input type="checkbox" data-proposal-field="${key}" ${candidate.selections[key] ? 'checked' : ''}><strong>${label}</strong></label><div class="proposal-compare"><div><span>当前</span><ul>${current.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div><div><span>AI 建议</span><ul>${suggested.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></div></article>`).join('')}<div class="battle-card-proposal-actions"><button type="button" data-battle-card-action="apply">应用所选</button><button type="button" data-battle-card-action="discard">保留当前作战卡</button></div></section>`;
}

async function handleBattleCardAction(event) {
  const material = event.target.closest('[data-material]');
  if (material) {
    state.session.materials[material.dataset.material] = material.checked;
    touchBattleCardDraft();
    return;
  }
  const question = event.target.closest('[data-card-question]');
  if (question) {
    setStage('during');
    els.recordText.value = question.dataset.cardQuestion;
    return;
  }
  const proposalAction = event.target.closest('[data-battle-card-action]');
  if (proposalAction) {
    handleBattleCardProposalAction(proposalAction.dataset.battleCardAction);
    return;
  }
  if (!event.target.closest('#optimizeBattleCardButton')) return;
  if (['connecting', 'generating'].includes(state.battleCardOptimization.status)) {
    stopBattleCardOptimization();
    return;
  }
  await startBattleCardOptimization();
}

function handleBattleCardChange(event) {
  const checkbox = event.target.closest('[data-proposal-field]');
  if (!checkbox || !state.battleCardProposal || state.battleCardProposal.status !== 'ready') return;
  state.battleCardProposal.selections[checkbox.dataset.proposalField] = checkbox.checked;
  renderBattleCard();
}

function handleBattleCardProposalAction(action) {
  const candidate = state.battleCardProposal;
  if (action === 'undo') return undoBattleCardApply();
  if (action === 'discard') {
    state.battleCardProposal = null;
    state.battleCardOptimization = { ...state.battleCardOptimization, status: 'idle', errorMessage: '' };
    renderBattleCard();
    return;
  }
  if (!candidate || candidate.status !== 'ready') return;
  if (action === 'select-all' || action === 'clear-selection') {
    Object.keys(candidate.selections).forEach((key) => { candidate.selections[key] = action === 'select-all'; });
    renderBattleCard();
    return;
  }
  if (action === 'apply') applyBattleCardProposal();
}

function applyBattleCardProposal() {
  const candidate = state.battleCardProposal;
  if (!candidate || candidate.status !== 'ready' || candidate.baseRevision !== state.battleCardRevision) return;
  const selected = Object.entries(candidate.selections).filter(([, checked]) => checked).map(([key]) => key);
  if (!selected.length) return;
  state.lastAppliedBattleCardDraft = cloneBattleCardDraft(state.battleCardDraft);
  state.lastAppliedMaterials = { ...state.session.materials };
  const next = cloneBattleCardDraft(state.battleCardDraft);
  selected.forEach((field) => { next[field] = Array.isArray(candidate.proposal[field]) ? [...candidate.proposal[field]] : candidate.proposal[field]; });
  if (selected.includes('materials')) {
    state.session.materials = Object.fromEntries(next.materials.map((item) => [item, Boolean(state.session.materials[item])]));
  }
  state.battleCardDraft = next;
  state.battleCardProposal = null;
  state.battleCardRevision += 1;
  state.lastApplySummary = `已应用 ${selected.length} 项 AI 建议，可撤销本次应用。`;
  state.battleCardOptimization = { ...state.battleCardOptimization, status: 'applied', errorMessage: '' };
  renderBattleCard();
}

function undoBattleCardApply() {
  if (!state.lastAppliedBattleCardDraft) return;
  state.battleCardDraft = cloneBattleCardDraft(state.lastAppliedBattleCardDraft);
  state.session.materials = { ...state.lastAppliedMaterials };
  state.lastAppliedBattleCardDraft = null;
  state.lastAppliedMaterials = null;
  state.lastApplySummary = '已撤销本次 AI 应用。';
  state.battleCardRevision += 1;
  state.battleCardOptimization = { ...state.battleCardOptimization, status: 'idle', errorMessage: '' };
  renderBattleCard();
}

async function startBattleCardOptimization() {
  stopBattleCardOptimization({ keepResult: true, render: false });
  const requestRevision = state.battleCardRevision;
  const controller = new AbortController();
  state.battleCardAbortController = controller;
  state.battleCardOptimization = { status: 'connecting', content: '', errorMessage: '', startedAt: Date.now(), elapsedSeconds: 0 };
  startBattleCardTimer();
  renderBattleCard();
  try {
    const response = await fetch('/api/scenes/customer_communication/execution/battle-card/optimize-stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ meetingType: state.meetingType, session: state.session, battleCard: state.battleCardDraft }) });
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('本地服务仍在运行旧版本，未加载流式作战卡接口。请停止当前 npm start 后重新运行 npm start，并刷新页面。');
      }
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.errorMessage || 'AI 优化失败。');
    }
    await readSseStream(response, (event, payload) => {
      if (controller.signal.aborted || state.battleCardAbortController !== controller) return;
      if (event === 'delta') {
        state.battleCardOptimization.status = 'generating';
      }
      if (event === 'error') {
        state.battleCardOptimization.status = 'error';
        state.battleCardOptimization.errorMessage = payload.errorMessage || 'AI 优化失败，请重试。';
      }
      if (event === 'done') {
        if (!payload.proposal) {
          state.battleCardOptimization.status = 'error';
          state.battleCardOptimization.errorMessage = 'AI 未返回可用的作战卡候选，请重新生成。';
        } else {
          state.battleCardProposal = {
            status: requestRevision === state.battleCardRevision ? 'ready' : 'stale',
            proposal: payload.proposal,
            selections: { meetingGoal: true, priorityQuestions: true, materials: true, riskReminders: true },
            baseRevision: requestRevision
          };
          state.battleCardOptimization.status = 'completed';
        }
      }
      renderBattleCard();
    });
    if (!controller.signal.aborted && ['connecting', 'generating'].includes(state.battleCardOptimization.status)) {
      state.battleCardOptimization.status = 'error';
      state.battleCardOptimization.errorMessage = 'AI 未返回可用的作战卡候选，请重新生成。';
      renderBattleCard();
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    state.battleCardOptimization.status = 'error';
    state.battleCardOptimization.errorMessage = error.message || 'AI 优化失败，请重试。';
    renderBattleCard();
  } finally {
    if (state.battleCardAbortController === controller) {
      state.battleCardAbortController = null;
      stopBattleCardTimer();
    }
  }
}

function stopBattleCardOptimization({ keepResult = true, render = true } = {}) {
  const wasGenerating = ['connecting', 'generating'].includes(state.battleCardOptimization.status);
  state.battleCardAbortController?.abort();
  state.battleCardAbortController = null;
  stopBattleCardTimer();
  if (wasGenerating) {
    state.battleCardOptimization = {
      ...state.battleCardOptimization,
      status: 'cancelled',
      errorMessage: keepResult && state.battleCardOptimization.content ? '' : '已停止生成，可重新生成。'
    };
  }
  if (render) renderBattleCard();
}

function startBattleCardTimer() {
  stopBattleCardTimer();
  state.battleCardTimer = setInterval(() => {
    if (!state.battleCardOptimization.startedAt) return;
    state.battleCardOptimization.elapsedSeconds = Math.floor((Date.now() - state.battleCardOptimization.startedAt) / 1000);
    renderBattleCard();
  }, 1000);
}

function stopBattleCardTimer() {
  if (state.battleCardTimer) clearInterval(state.battleCardTimer);
  state.battleCardTimer = null;
}

function createBattleCardDraft(config) {
  return {
    meetingGoal: config.successItems[0],
    priorityQuestions: [...config.questions],
    materials: [...config.materials],
    riskReminders: []
  };
}

function cloneBattleCardDraft(draft) {
  return draft ? {
    meetingGoal: draft.meetingGoal,
    priorityQuestions: [...draft.priorityQuestions],
    materials: [...draft.materials],
    riskReminders: [...draft.riskReminders]
  } : null;
}

function resetBattleCardDraft() {
  state.battleCardDraft = null;
  state.battleCardProposal = null;
  state.lastAppliedBattleCardDraft = null;
  state.lastAppliedMaterials = null;
  state.lastApplySummary = '';
  state.battleCardOptimization = { status: 'idle', content: '', errorMessage: '', startedAt: 0, elapsedSeconds: 0 };
  state.battleCardRevision += 1;
}

function touchBattleCardDraft() {
  if (!state.battleCardDraft) return;
  state.battleCardRevision += 1;
  if (state.battleCardProposal?.status === 'ready') {
    state.battleCardProposal.status = 'stale';
  }
  renderBattleCard();
}

function battleCardStatusText(optimization) {
  const elapsed = optimization.elapsedSeconds ? ` · ${optimization.elapsedSeconds}s` : '';
  if (optimization.status === 'connecting') return `正在连接 DeepSeek${elapsed}`;
  if (optimization.status === 'generating') return `正在生成${elapsed}`;
  if (optimization.status === 'completed') return '生成完成';
  if (optimization.status === 'applied') return '已应用候选方案';
  if (optimization.status === 'cancelled') return '已停止生成';
  if (optimization.status === 'error') return '生成失败，可重试';
  return '尚未生成';
}

function renderDuring() {
  const config = typeConfig();
  if (!config) {
    els.duringSummary.innerHTML = '<p class="execution-empty">请先在会前选择会议类型并生成作战卡。</p>';
    els.duringProgress.textContent = '请选择会议类型';
    els.liveQuestions.replaceChildren(); els.liveKeyItems.replaceChildren(); els.recordTypes.replaceChildren(); els.recordList.replaceChildren();
    return;
  }
  const done = config.keyItems.filter((item) => state.session.keyItems[item]).length;
  els.duringProgress.textContent = `关键项 ${done}/${config.keyItems.length} · 已记录 ${state.session.records.length}`;
  els.duringSummary.innerHTML = `<strong>${escapeHtml(config.successItems[0])}</strong><span>未确认事项请标记为待核实，避免写入正式结论。</span><em>${escapeHtml(config.guardrails[0])}</em>`;
  els.liveQuestions.replaceChildren(...config.questions.map((question) => questionButton(question)));
  els.liveKeyItems.innerHTML = config.keyItems.map((item) => `<label><input type="checkbox" data-key-item="${escapeHtml(item)}" ${state.session.keyItems[item] ? 'checked' : ''}>${escapeHtml(item)}</label>`).join('');
  renderRecordTypes();
  renderRecordList();
}

function questionButton(question) {
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.question = question; button.textContent = question;
  return button;
}

function renderRecordTypes() {
  const recordTypes = state.config?.recordTypes || [];
  els.recordTypes.innerHTML = recordTypes.map((type) => `<button type="button" data-record-type="${escapeHtml(type.id)}" class="${type.id === state.selectedRecordType ? 'active' : ''}">${escapeHtml(type.label)}</button>`).join('');
}

function addLiveRecord() {
  const text = els.recordText.value.trim();
  if (!text) return;
  const type = (state.config?.recordTypes || []).find((item) => item.id === state.selectedRecordType) || { id: 'other', label: '其他记录' };
  state.session.records.push({ id: `${Date.now()}-${Math.random()}`, type: type.id, label: type.label, text, status: els.recordConfirmed.checked ? 'confirmed' : 'questionable' });
  els.recordText.value = '';
  renderDuring();
}

function renderRecordList() {
  els.recordList.innerHTML = state.session.records.length ? state.session.records.map((record) => `<article data-record-id="${record.id}"><div><span class="record-status ${record.status}">${record.status === 'confirmed' ? '已确认' : '待核实'}</span><strong>${escapeHtml(record.label)}</strong></div><p>${escapeHtml(record.text)}</p><button type="button" data-record-action="toggle">切换状态</button><button type="button" data-record-action="remove">删除</button></article>`).join('') : '<p class="execution-empty">尚无记录。用一句话记录即可，之后可随时修改状态。</p>';
}

function handleRecordAction(event) {
  const action = event.target.closest('[data-record-action]');
  const item = event.target.closest('[data-record-id]');
  if (!action || !item) return;
  const index = state.session.records.findIndex((record) => record.id === item.dataset.recordId);
  if (index < 0) return;
  if (action.dataset.recordAction === 'remove') state.session.records.splice(index, 1);
  else state.session.records[index].status = state.session.records[index].status === 'confirmed' ? 'questionable' : 'confirmed';
  renderDuring();
}

function prepareAfterMeeting() {
  if (!state.meetingType) return setInputMessage('请先选择会议类型。', true);
  els.source.value = buildAfterSource();
  state.attachment = null;
  els.fileName.textContent = '';
  setStage('after');
  setInputMessage('已预填会前作战卡与会中记录；可继续补充原始纪要后再解析。');
}

function buildAfterSource() {
  const selected = Object.entries(state.session.selections).filter(([, value]) => Array.isArray(value) ? value.length : value).map(([key, value]) => `${key}：${Array.isArray(value) ? value.join('、') : value}`);
  const records = state.session.records.map((record) => `[${record.status === 'confirmed' ? '已确认' : '待核实'}][${record.label}] ${record.text}`);
  return [`客户：${state.session.customerName || '待确认'}`, `会议类型：${state.meetingType} 类`, `会议背景：${state.session.background || '待确认'}`, ...selected, '会中记录：', ...records].join('\n');
}

async function handleFile() {
  const file = els.fileInput.files?.[0];
  if (!file) return;
  els.fileName.textContent = file.name;
  els.sourceState.textContent = '读取中…';
  try {
    const text = /\.docx$/i.test(file.name) ? await readDocx(file) : await file.text();
    state.attachment = { name: file.name, text };
    els.source.value = text;
    els.sourceState.textContent = '资料已载入';
  } catch (error) { setInputMessage(error.message || '文件读取失败。', true); }
}

async function readDocx(file) {
  const form = new FormData(); form.append('file', file);
  const response = await fetch('/api/attachments/docx-text', { method: 'POST', body: form });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.errorMessage || 'Word 文档读取失败。');
  return payload.text;
}

async function extractMeeting() {
  const userInput = els.source.value.trim();
  if (!userInput) return setInputMessage('请粘贴会议内容或上传文档。', true);
  if (!state.meetingType) return setInputMessage('请先选择会议类型。', true);
  setBusy(true); setInputMessage('正在提取会议事实…');
  try {
    const response = await fetch('/api/scenes/customer_communication/execution/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userInput, meetingType: state.meetingType, sourceName: state.attachment?.name || '会议执行记录', liveRecords: state.session.records }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.errorMessage || '资料解析失败。');
    state.workspace = payload.workspace; clearDocuments(); setInputMessage('解析完成，请确认候选事实。'); renderFacts();
  } catch (error) { setInputMessage(error.message || '资料解析失败。', true); } finally { setBusy(false); }
}

function renderFacts() {
  const fields = state.workspace?.fields || [];
  els.factEmpty.classList.toggle('hidden', fields.length > 0);
  els.factList.replaceChildren(...fields.map(renderFact));
  updateSummary();
}

function renderFact(field) {
  const item = document.createElement('article'); item.className = `fact-item status-${field.status}`; item.dataset.id = field.id;
  item.innerHTML = `<div class="fact-title"><div><span class="requirement ${field.requirement}${field.group === 'sop_required' ? ' sop-required' : ''}">${requirementLabel(field)}</span><strong>${escapeHtml(field.label)}</strong></div><span class="status-label">${statusLabel(field.status)}</span></div><textarea data-role="value" placeholder="可手动补充">${escapeHtml(field.value)}</textarea><details${field.evidence ? ' open' : ''}><summary>原文证据</summary><p>${escapeHtml(field.evidence || '暂无原文证据')}</p></details><div class="fact-actions"><button type="button" data-action="confirm">确认</button><button type="button" data-action="questionable">标记存疑</button><button type="button" data-action="ignore">忽略</button></div>`;
  return item;
}

function handleFactEdit(event) { const item = event.target.closest('.fact-item'); const field = fieldById(item?.dataset.id); if (!field || event.target.dataset.role !== 'value') return; field.value = event.target.value.trim(); if (field.value && field.status === 'missing') field.status = 'pending'; updateSummary(); }
function handleFactAction(event) { const button = event.target.closest('[data-action]'); const item = event.target.closest('.fact-item'); const field = fieldById(item?.dataset.id); if (!button || !field) return; const value = item.querySelector('[data-role="value"]').value.trim(); if (button.dataset.action === 'confirm' && !value) return; field.value = value; field.status = ({ confirm: 'confirmed', questionable: 'questionable', ignore: 'ignored' })[button.dataset.action]; field.updatedAt = new Date().toISOString(); renderFacts(); }
function updateSummary() { const fields = state.workspace?.fields || []; const confirmed = fields.filter((field) => field.status === 'confirmed').length; const pending = fields.filter((field) => field.status === 'pending').length; const gaps = fields.filter((field) => field.requirement === 'required' && field.status !== 'confirmed').length; els.factSummary.textContent = `已确认 ${confirmed} · 待处理 ${pending}`; els.gapSummary.innerHTML = gaps ? `<strong>${gaps} 个必须项未确认</strong><span>未确认内容不会写入正式事实</span>` : '<strong>必须项已确认</strong><span>可以生成正式材料</span>'; els.generate.disabled = !fields.length || confirmed === 0; }

async function generateDocuments() { const response = await fetch('/api/scenes/customer_communication/execution/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: state.workspace }) }); const payload = await response.json(); if (!response.ok) return setInputMessage(payload.errorMessage || '文档生成失败。', true); state.documents = payload; state.activeDocument = 'minutes'; els.tabs.classList.remove('hidden'); els.preview.classList.remove('hidden'); els.outputActions.classList.remove('hidden'); renderDocument(); }
function renderDocument() { const minutes = state.activeDocument === 'minutes'; els.tabs.querySelectorAll('[data-document]').forEach((button) => button.classList.toggle('active', button.dataset.document === state.activeDocument)); els.preview.value = minutes ? state.documents.minutesMarkdown : state.documents.followUpMarkdown; }
function clearDocuments() { state.documents = null; state.activeDocument = 'minutes'; els.tabs.classList.add('hidden'); els.preview.classList.add('hidden'); els.outputActions.classList.add('hidden'); els.preview.value = ''; }
function downloadMarkdown() { downloadBlob(new Blob([els.preview.value], { type: 'text/markdown;charset=utf-8' }), `${state.activeDocument === 'minutes' ? '会议纪要' : '跟进计划'}.md`); }
async function downloadWord() { const label = state.activeDocument === 'minutes' ? '会议纪要' : '跟进计划'; const response = await fetch('/api/scenes/customer_communication/execution/export-docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: state.workspace, documentType: state.activeDocument === 'minutes' ? 'minutes' : 'follow_up', markdown: els.preview.value, title: `${state.documents.title}-${label}` }) }); if (!response.ok) return setInputMessage('Word 导出失败。', true); downloadBlob(await response.blob(), `${label}.docx`); }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
function fieldById(id) { return state.workspace?.fields.find((field) => field.id === id); }
function requirementLabel(field) { return field.group === 'sop_required' ? 'SOP 必做' : field.requirement === 'required' ? '必须' : '建议'; }
function statusLabel(status) { return ({ pending: '待确认', confirmed: '已确认', questionable: '存疑', ignored: '已忽略', missing: '缺失' })[status] || '待确认'; }
function setBusy(busy) { els.extract.disabled = busy; els.extract.textContent = busy ? '解析中…' : '解析资料'; }
function setInputMessage(message, isError = false) { els.sourceState.textContent = message; els.sourceState.classList.toggle('error', isError); }
function escapeHtml(value) { const node = document.createElement('div'); node.textContent = String(value || ''); return node.innerHTML; }
