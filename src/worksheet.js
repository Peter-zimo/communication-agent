export function createWorksheet(meetingType, node) {
  return {
    meetingType,
    stage: node.stage,
    sopNodeId: node.id,
    title: node.title,
    fields: (node.mustDo || []).map((label) => ({
      label,
      value: '待确认',
      source: '需要用户补充'
    })),
    risks: node.guardrails || []
  };
}

export function applyExtractedWorksheetFields(worksheet, extractedFields = []) {
  const extractedByLabel = new Map(
    (Array.isArray(extractedFields) ? extractedFields : [])
      .filter((field) => field && field.label)
      .map((field) => [String(field.label).trim(), field])
  );

  return {
    ...worksheet,
    fields: worksheet.fields.map((field) => {
      const extracted = extractedByLabel.get(field.label);
      const value = String(extracted?.value || '').trim();
      return value && value !== '待确认'
        ? { ...field, value, source: '信息来源于纪要' }
        : field;
    })
  };
}

export function worksheetToMarkdown(worksheet = {}) {
  const fields = Array.isArray(worksheet.fields) ? worksheet.fields : [];
  const risks = Array.isArray(worksheet.risks) ? worksheet.risks : [];
  const pending = fields.filter((field) => String(field.value || '').trim() === '待确认');
  const lines = [
    `## ${worksheet.title || '会议工作表'}`,
    `- 会议类型：${worksheet.meetingType || '待确认'}`,
    `- 当前阶段：${stageLabel(worksheet.stage)}`,
    '### 必做项'
  ];

  fields.forEach((field) => lines.push(`- ${field.label}：${field.value || '待确认'}`));
  if (pending.length) {
    lines.push('### 待确认信息');
    pending.forEach((field) => lines.push(`- ${field.label}`));
  }
  if (risks.length) {
    lines.push('### 风险与边界');
    risks.forEach((risk) => lines.push(`- ${risk}`));
  }
  return lines.join('\n');
}

function stageLabel(stage) {
  return ({ before_meeting: '会前', during_meeting: '会中', after_meeting: '会后' })[stage] || '待确认';
}
