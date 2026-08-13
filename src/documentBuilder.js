import { getMeetingGaps, normalizeMeetingWorkspace } from './meetingWorkspace.js';

export function buildMeetingDocuments(input) {
  const workspace = normalizeMeetingWorkspace(input);
  const confirmed = new Map(
    workspace.fields
      .filter((field) => field.status === 'confirmed' && field.value)
      .map((field) => [field.id, field])
  );
  const gaps = getMeetingGaps(workspace);
  const pending = workspace.fields.filter((field) => !['confirmed', 'ignored'].includes(field.status));
  const title = `${workspace.meetingType}类${workspace.meetingTypeLabel || ''}会议纪要`;
  const lines = [
    `# ${title}`,
    '',
    '## 会议结论',
    valueOrPending(confirmed.get('meeting_conclusion')),
    '',
    '## SOP 必做项确认'
  ];

  appendConfirmedFields(lines, workspace.fields.filter((field) => field.group === 'sop_required' && field.status === 'confirmed'));
  lines.push(
    '',
    '## 已确认事实'
  );

  appendConfirmed(lines, confirmed, ['customer_needs', 'executive_contact', 'stakeholders', 'confirmed_constraints', 'decisions']);
  appendConfirmedFields(lines, workspace.fields.filter((field) => field.group === 'live_record' && field.status === 'confirmed'));
  lines.push('', '## 行动项', '### 客户侧行动项', valueOrPending(confirmed.get('customer_actions')));
  lines.push('', '### 我方行动项', valueOrPending(confirmed.get('internal_actions')));
  lines.push('', '## 下一步建议', valueOrPending(confirmed.get('next_step')));
  if (confirmed.has('risks')) lines.push('', '## 风险与边界', `- ${confirmed.get('risks').value}`);
  if (pending.length) {
    lines.push('', '## 待确认事项');
    pending.forEach((field) => lines.push(`- ${field.label}${field.value ? `：${field.value}` : ''}`));
  }

  const markdown = lines.join('\n');
  return {
    title,
    markdown,
    minutesMarkdown: markdown,
    followUpMarkdown: buildFollowUp(workspace, confirmed, pending),
    gaps
  };
}

function appendConfirmed(lines, confirmed, ids) {
  let count = 0;
  ids.forEach((id) => {
    const field = confirmed.get(id);
    if (!field) return;
    lines.push(`- ${field.label}：${field.value}`);
    count += 1;
  });
  if (!count) lines.push('- 暂无已确认事实');
}

function appendConfirmedFields(lines, fields) {
  if (!fields.length) {
    lines.push('- 暂无已确认的 SOP 必做项');
    return;
  }
  fields.forEach((field) => lines.push(`- ${field.label}：${field.value}`));
}

function buildFollowUp(workspace, confirmed, pending) {
  const lines = [
    `# ${workspace.meetingType}类会议跟进计划`,
    '',
    '## 客户侧行动项',
    valueOrPending(confirmed.get('customer_actions')),
    '',
    '## 我方行动项',
    valueOrPending(confirmed.get('internal_actions')),
    '',
    '## 下一步及时间节点',
    valueOrPending(confirmed.get('next_step'))
  ];
  if (pending.length) {
    lines.push('', '## 待确认事项');
    pending.forEach((field) => lines.push(`- ${field.label}`));
  }
  return lines.join('\n');
}

function valueOrPending(field) {
  return field?.value ? `- ${field.value}` : '- 待确认';
}
