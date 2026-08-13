import { buildChatMessages } from './promptBuilder.js';

const OTHER_STAGE_HEADINGS = ['真实问题判断', '建议追问', '回应框架', '本次交流定位'];

export function buildTaskMessages(content, request) {
  const task = request.task || {};
  if (task.needsClarification) {
    return [
      { role: 'system', content: content.skillPrompt },
      { role: 'user', content: task.clarificationQuestion }
    ];
  }

  const meetingType = (content.scene.meetingTypes || []).find((item) => item.id === task.meetingType);
  const node = (meetingType?.sopNodes || []).find((item) => item.stage === task.stage);
  if (!meetingType || !node) throw new Error('未找到当前任务对应的专属 SOP。');

  return buildChatMessages(content, {
    userInput: request.userInput,
    meetingType: task.meetingType,
    taskId: task.taskId,
    sopNodeId: node.id,
    attachments: request.attachments,
    customerContext: request.customerContext || {},
    conversationHistory: request.conversationHistory || []
  });
}

export function validateTaskOutput(markdown, taskId) {
  const lines = String(markdown || '').split('\n').map((line) => line.trim());
  const issues = [];
  let underSubheading = false;

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      underSubheading = true;
      continue;
    }
    if (/^##\s+/.test(line)) {
      underSubheading = false;
      if (taskId === 'after_meeting' && OTHER_STAGE_HEADINGS.some((heading) => line.includes(heading))) {
        issues.push('包含不属于当前阶段模板的标题。');
      }
      continue;
    }
    if (underSubheading && /^\d+[.)、]\s+/.test(line)) issues.push('二级标题下不得使用数字序号。');
  }

  if (taskId === 'after_meeting') {
    const fullText = lines.join('\n');
    if (!fullText.includes('行动项')) issues.push('会后复盘必须包含行动项。');
    if (!fullText.includes('下一')) issues.push('会后复盘必须包含下一步建议。');
  }

  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}
