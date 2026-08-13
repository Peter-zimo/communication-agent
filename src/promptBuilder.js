const TASK_NAMES = new Map([
  ['before_meeting', '交流前准备'],
  ['during_meeting', '交流中追问'],
  ['after_meeting', '交流后复盘'],
  ['free_chat', '自由提问']
]);

const TEMPLATE_KEYS = new Map([
  ['before_meeting', 'before_meeting'],
  ['during_meeting', 'during_meeting'],
  ['after_meeting', 'after_meeting']
]);

const PRODUCT_MATRIX = [
  '【产品矩阵推荐顺序（仅 A 类初次交流参考）】',
  '1. ZIWIGPT 智维 AI 专家：专家经验传承、数据管理及传统软件 Agent 化、智能文档平台。',
  '2. HOLOWELLS 井工程数字孪生平台：井工程地面/地下数字孪生、井控仿真、作业过程数字化管理。',
  '3. XRSim 工程仿真系统：轻量化 VR 模拟培训、复杂工艺仿真。',
  '所有产品关联建议标注"需内部确认"。'
].join('\n');

const CUSTOMER_FAQ_PATTERNS = [
  '【客户常见问题回应原则（会中追问参考）】',
  '预算问题：项目体量取决于数据数量/类型/质量/功能模块数量/系统集成范围和交付形态。不可现场报固定价格。可反问客户立项金额区间。',
  '试用问题：演示版效果可控的能力可评估释放试用；需客户数据/规则/标注定制的能力不建议轻易试用。必须设置试用范围/使用人/反馈方式/成功标准。',
  '友商比较：先尊重客户已有建设 → 说明维泰差分点 → 回到客户现有系统未解决问题。不得贬低友商。'
].join('\n');

const POC_PRINCIPLES = [
  '【POC 初判原则（B/C 类会后参考）】',
  '适合推进：数据明确、能获取样例、客户提供业务规则、价值明确、有评价人、范围可控。',
  '不适合推进：领导意愿不明、已有满意系统无新增价值、数据来源不清、强依赖第三方但接口不明、无评价标准、试点范围过大。'
].join('\n');

export function buildChatMessages(content, request) {
  const userInput = String(request.userInput || '').trim();
  if (!userInput) {
    const error = new Error('用户输入为空');
    error.code = 'EMPTY_INPUT';
    throw error;
  }

  const meetingType = resolveMeetingTypeObject(content.scene, request.meetingType);
  const meetingTypeId = meetingType.id;
  const node = resolveTypeSopNode(meetingType, request.sopNodeId);
  const taskId = resolveTaskIdFromNode(node, request.taskId);
  const stageName = resolveStageName(content.scene, taskId);
  const detailNode = resolveDetailNode(node, request.currentDetailNodeId, content.reviewTemplate);
  const playbookStage = resolvePlaybookStage(content.playbooks, meetingTypeId, taskId);
  const customerContext = formatCustomerContext(meetingType, request.customerContext);

  const backgroundBlocks = buildBackgroundBlocks({
    sceneName: content.scene.sceneName || '客户交流会议',
    meetingType: `${meetingType.id} ${meetingType.name}`,
    meetingTypeObject: meetingType,
    customerContext,
    stageName,
    node,
    detailNode,
    playbookStage,
    recommendedQuestion: request.selectedRecommendedQuestion,
    conversationHistory: request.conversationHistory,
    attachments: request.attachments,
    completedNodeIds: request.completedNodeIds,
    incompletePreviousNodeIds: request.incompletePreviousNodeIds,
    meetingTypeId,
    taskId
  });

  return [
    { role: 'system', content: content.skillPrompt },
    {
      role: 'user',
      content: [
        '【用户问题】',
        userInput,
        '',
        '【回答指令】',
        '请直接回答用户问题，给出有针对性的核心答案。下面的"背景参考"只是当前会议类型的知识库。你只能依据当前会议类型的专属 SOP 输出建议，不得引用、回退或混用其他会议类型 SOP，不得默认按 A 类宽泛交流处理。信息不足时列出需补充信息，不得编造客户背景、预算、友商评价或项目事实。涉及公司产品能力、案例适配性、POC 可行性、部署形态时，未经依据一律标注"需内部确认"。如果用户问题明显属于其他会议类型，应建议用户切换会议类型，而不是混用流程。上传文档只作为本次回答参考，不得把文档内容自动当作已确认客户信息；若与已填写客户信息冲突，应标注需确认。',
        '',
        '--- 以下为背景参考 ---',
        '',
        ...backgroundBlocks,
        '',
        '【输出结构要求】',
        '必须优先使用当前阶段模板中的标题结构。',
        '只保留与用户问题相关的标题，不需要逐项填满。',
        '不得输出其他阶段的标题。',
        resolveOutputRules(content, taskId)
      ].join('\n')
    }
  ];
}

function buildBackgroundBlocks(ctx) {
  const blocks = [
    `【当前场景】${ctx.sceneName}`,
    `【当前交流性质】${ctx.meetingType || '未判断'}`,
    `【当前阶段】${ctx.stageName || '自由提问'}`
  ];

  blocks.push(`【客户信息】\n${ctx.customerContext.knownText}`);
  blocks.push(`【客户信息缺失项】\n${ctx.customerContext.missingText}`);
  blocks.push(`【SOP完成状态】\n${formatChecklistProgress(ctx.completedNodeIds, ctx.incompletePreviousNodeIds)}`);
  blocks.push(`【当前类型专属SOP】\n${formatTypeSopSummary(ctx.meetingTypeObject)}`);

  if (ctx.node) {
    blocks.push([
      '【当前SOP节点】',
      `节点标题：${ctx.node.title || ''}`,
      ctx.node.focus ? `节点关注点：${ctx.node.focus}` : ''
    ].filter(Boolean).join('\n'));
  }

  if (ctx.meetingTypeId === 'A' && ctx.taskId === 'before_meeting') {
    blocks.push(PRODUCT_MATRIX);
  }

  if (ctx.detailNode) {
    blocks.push(['【当前详情节点】', `列表：${formatList(ctx.detailNode.items)}`].join('\n'));
  }

  if (ctx.playbookStage) {
    blocks.push(['【当前类型打法】', formatPlaybookStage(ctx.playbookStage)].join('\n'));
  }

  if (ctx.recommendedQuestion) {
    blocks.push(`【当前推荐问题】${ctx.recommendedQuestion}`);
  }

  const attachmentText = formatAttachments(ctx.attachments);
  if (attachmentText) {
    blocks.push(`【本次上传文档】\n${attachmentText}`);
  }

  const historyText = formatConversationHistory(ctx.conversationHistory);
  if (historyText && historyText !== '暂无历史对话。') {
    blocks.push(`【最近对话】\n${historyText}`);
  }

  if (ctx.taskId === 'during_meeting') {
    blocks.push(CUSTOMER_FAQ_PATTERNS);
  }

  if ((ctx.meetingTypeId === 'B' || ctx.meetingTypeId === 'C') && ctx.taskId === 'after_meeting') {
    blocks.push(POC_PRINCIPLES);
  }

  return blocks;
}

function resolveTaskIdFromNode(node, explicitTaskId) {
  if (isValidStage(node?.stage)) return node.stage;
  if (explicitTaskId && explicitTaskId !== 'free_chat') return explicitTaskId;
  return explicitTaskId || 'free_chat';
}

function isValidStage(stage) {
  return stage === 'before_meeting' || stage === 'during_meeting' || stage === 'after_meeting';
}

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

function resolveStageName(scene, taskId) {
  const fromScene = (scene.tasks || []).find((item) => item.id === taskId);
  const name = TASK_NAMES.get(taskId) || fromScene?.name;
  return name || '自由提问';
}

function resolvePlaybookStage(playbooks, meetingTypeId, taskId) {
  const playbook = playbooks?.[String(meetingTypeId || '').toUpperCase()];
  return playbook?.stages?.find((stage) => stage.id === taskId);
}

function resolveDetailNode(node, detailNodeId, reviewTemplate) {
  if (!node || !detailNodeId) return null;

  const detailNodes = [
    { id: 'focus', title: '关注点', items: node.focus ? [node.focus] : [] },
    { id: 'mustDo', title: '必做项', items: node.mustDo },
    { id: 'suggested', title: '建议项', items: node.suggested },
    { id: 'experienceTips', title: '经验提醒', items: node.experienceTips },
    { id: 'commonMistakes', title: '常见错误', items: node.commonMistakes },
    { id: 'aiCanHelp', title: '可问 AI', items: node.aiCanHelp },
    { id: 'outputs', title: '本节点输出物', items: node.outputs }
  ];

  if (node.id === 'after_meeting_review_and_next_step' && Array.isArray(reviewTemplate?.items)) {
    detailNodes.push({ id: 'reviewTemplate', title: reviewTemplate.title || '会后复盘模板', items: reviewTemplate.items });
  }

  return detailNodes.find((item) => item.id === detailNodeId) || null;
}

function formatPlaybookStage(stage) {
  if (!stage) return '未选择或暂无对应打法。';
  return stage.sections
    .map((section) => [`${section.title}：`, formatList(section.items)].join('\n'))
    .join('\n');
}

function formatAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  return attachments
    .slice(0, 1)
    .map((attachment) => {
      const fileName = String(attachment.fileName || '未命名文档').trim();
      const fileType = String(attachment.fileType || 'document').trim();
      const body = String(attachment.text || '').trim().slice(0, 12000);
      if (!body) return '';
      return `文件：${fileName}（${fileType}）\n内容摘录：\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function formatConversationHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return '暂无历史对话。';

  return history
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .slice(-8)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${String(message.content || '').trim()}`)
    .filter((line) => !line.endsWith('：'))
    .join('\n') || '暂无历史对话。';
}

function formatChecklistProgress(completedNodeIds = [], incompletePreviousNodeIds = []) {
  const completed = Array.isArray(completedNodeIds) && completedNodeIds.length
    ? completedNodeIds.join('、')
    : '暂无。';
  const incompletePrevious = Array.isArray(incompletePreviousNodeIds) && incompletePreviousNodeIds.length
    ? incompletePreviousNodeIds.join('、')
    : '无。';
  return [
    `已完成节点：${completed}`,
    `未完成前置节点：${incompletePrevious}`,
    '这是半强制流程状态：允许继续回答，但如存在未完成前置节点，需要提醒用户先补齐关键上下文。'
  ].join('\n');
}

function resolveOutputRules(content, taskId) {
  const templateKey = TEMPLATE_KEYS.get(taskId);
  if (templateKey && content.templates[templateKey]) return formatStageOutputRules(content.templates[templateKey]);
  return '如果是自由提问，按“结论先行 + 建议行动 + 需确认事项 + 不可承诺事项”输出。';
}

function formatStageOutputRules(template) {
  const titles = extractTemplateTitles(template);
  const titleBlock = titles.length
    ? ['当前阶段允许标题及顺序：', ...titles].join('\n')
    : cleanOutputTemplate(template);

  const afterMeetingRequirement = template.includes('客户侧行动项')
    ? '会后复盘必须覆盖会议结论、已确认事实、信息缺口、客户侧行动项、我方行动项和下一步推进建议。'
    : '';

  return [
    titleBlock,
    '严格结构约束：',
    '1. 只能使用上面列出的标题，不得新增模板之外的标题。',
    '2. 可以省略与用户问题无关的标题，但剩余标题必须保持原始相对顺序。',
    '3. 保留标题后，标题编号必须重新连续，不得沿用被省略标题后的模板原始编号。',
    '4. 二级标题下的行动项、选项、下一步动作、风险和建议统一使用 - 无序列表，不得把标题编号和列表编号混用。',
    '5. 不得输出其他阶段标题，不得把会前、会中、会后的标题混在一起。',
    '6. 每个标题只承载对应内容，避免把同一条建议跨标题重复输出。',
    '7. 不得输出空标题、空列表或占位符；没有信息时写“待确认”。',
    '8. 二级标题下不得输出数字序号、跳号或重复编号；使用黑点列表表达并列内容。',
    '9. 需要表达先后顺序时，用“优先确认”“随后推进”“确认后执行”等文字说明，不依赖列表数字。',
    '10. 责任人或时间点未知时写“责任人待确认”“时间待确认”，不得输出空方括号占位 []、[ ] 或【】。',
    '11. 二级标题下补充说明写在同一条黑点条目内，不要打断列表结构。'
    , afterMeetingRequirement
  ].filter(Boolean).join('\n');
}

function extractTemplateTitles(template) {
  const seen = new Set();
  return String(template || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('## ') || line.startsWith('### '))
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function cleanOutputTemplate(template) {
  const cleaned = String(template || '')
    .split('\n')
    .filter((line) => {
      const text = line.trim();
      return text && !text.startsWith('# 输出格式参考') && !text.startsWith('以下结构仅供参考');
    })
    .join('\n');
  return cleaned || '按“结论先行 + 建议行动 + 需确认事项 + 不可承诺事项”输出。';
}

function formatList(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.map((item) => `- ${item}`).join('\n');
}





