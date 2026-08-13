const TYPE_LABELS = {
  A: '初步交流',
  B: '意向交流',
  C: '方案汇报'
};

const COMMON_FIELD_DEFINITIONS = [
  ['meeting_conclusion', '本次会议结论', 'required'],
  ['customer_needs', '客户需求与关注点', 'required'],
  ['executive_contact', '客户最高层级联系人', 'required'],
  ['stakeholders', '关键参与人及角色', 'suggested'],
  ['confirmed_constraints', '已确认的范围与约束', 'required'],
  ['decisions', '客户已确认的决定', 'required'],
  ['customer_actions', '客户侧行动项', 'required'],
  ['internal_actions', '我方行动项', 'required'],
  ['next_step', '下一步及时间节点', 'required'],
  ['risks', '风险与待内部确认事项', 'suggested']
];

export function createMeetingWorkspace({ meetingType, sourceName = '会议资料', sopNode } = {}) {
  const normalizedType = String(meetingType || '').toUpperCase();
  if (!TYPE_LABELS[normalizedType]) throw new Error('请选择有效的会议类型 A、B 或 C。');

  return {
    version: 1,
    meetingType: normalizedType,
    meetingTypeLabel: TYPE_LABELS[normalizedType],
    stage: 'after_meeting',
    sourceName,
    createdAt: new Date().toISOString(),
    sopNodeId: String(sopNode?.id || ''),
    fields: [
      ...createSopRequiredFields(normalizedType, sopNode, sourceName),
      ...COMMON_FIELD_DEFINITIONS.map(([id, label, requirement]) => ({
      id,
      label,
      requirement,
      group: 'document',
      value: '',
      status: 'missing',
      source: sourceName,
      evidence: '',
      confidence: 0,
      updatedAt: ''
      }))
    ]
  };
}

function createSopRequiredFields(meetingType, sopNode, sourceName) {
  return (Array.isArray(sopNode?.mustDo) ? sopNode.mustDo : []).map((label, index) => ({
    id: `sop_${meetingType.toLowerCase()}_must_do_${index + 1}`,
    label: String(label),
    requirement: 'required',
    group: 'sop_required',
    value: '',
    status: 'missing',
    source: sourceName,
    evidence: '',
    confidence: 0,
    updatedAt: ''
  }));
}

export function applyMeetingExtraction(workspace, extractedFields = []) {
  const extractedById = new Map(
    (Array.isArray(extractedFields) ? extractedFields : [])
      .filter((field) => field?.id)
      .map((field) => [String(field.id), field])
  );

  return {
    ...workspace,
    fields: workspace.fields.map((field) => {
      const extracted = extractedById.get(field.id);
      const value = String(extracted?.value || '').trim();
      if (!value) return field;
      return {
        ...field,
        value,
        status: 'pending',
        evidence: String(extracted?.evidence || '').trim(),
        confidence: normalizeConfidence(extracted?.confidence),
        updatedAt: new Date().toISOString()
      };
    })
  };
}

export function appendLiveRecordFields(workspace, liveRecords = []) {
  const fields = (Array.isArray(liveRecords) ? liveRecords : [])
    .filter((record) => String(record?.text || '').trim())
    .map((record, index) => ({
      id: `live_record_${index + 1}`,
      label: String(record.label || '会议记录').trim(),
      requirement: 'suggested',
      group: 'live_record',
      value: String(record.text).trim(),
      status: record.status === 'confirmed' ? 'confirmed' : 'questionable',
      source: '会中动态清单',
      evidence: String(record.text).trim(),
      confidence: record.status === 'confirmed' ? 1 : 0,
      updatedAt: new Date().toISOString()
    }));
  return { ...workspace, fields: [...workspace.fields, ...fields] };
}

export function normalizeMeetingWorkspace(workspace = {}) {
  const allowedStatuses = new Set(['pending', 'confirmed', 'questionable', 'ignored', 'missing']);
  return {
    ...workspace,
    fields: (workspace.fields || []).map((field) => ({
      ...field,
      value: String(field.value || '').trim(),
      status: allowedStatuses.has(field.status) ? field.status : 'pending'
    }))
  };
}

export function getMeetingGaps(workspace = {}) {
  const fields = workspace.fields || [];
  return {
    required: fields.filter((field) => field.requirement === 'required' && field.status !== 'confirmed'),
    suggested: fields.filter((field) => field.requirement === 'suggested' && field.status !== 'confirmed')
  };
}

export function extractionMessages(workspace, sourceText) {
  const schema = workspace.fields.map(({ id, label }) => ({ id, label }));
  return [
    {
      role: 'system',
      content: '你是售前会议资料抽取助手。只能抽取原文明确表达的信息，不得推断、补全或把建议写成事实。'
    },
    {
      role: 'user',
      content: [
        `会议类型：${workspace.meetingType} 类 ${workspace.meetingTypeLabel}`,
        `允许抽取的字段：${JSON.stringify(schema)}`,
        '没有原文依据的字段不要输出。evidence 必须是原文中的短句。confidence 使用 0 到 1。',
        '只输出 JSON：{fields:[{id:字段ID,value:提取值,evidence:原文证据,confidence:0.8}]}',
        `会议资料：\n${String(sourceText || '').slice(0, 20000)}`
      ].join('\n')
    }
  ];
}

export function parseMeetingExtraction(answer) {
  const raw = String(answer || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return [];
  const parsed = JSON.parse(raw.slice(start, end + 1));
  return Array.isArray(parsed.fields) ? parsed.fields : [];
}

function normalizeConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}
