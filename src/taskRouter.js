const TASK_IDS = new Set(['before_meeting', 'during_meeting', 'after_meeting']);
const MEETING_TYPES = new Set(['A', 'B', 'C']);

export function resolveMeetingTask({ userInput = '', taskId = '', meetingType = '' } = {}) {
  const text = String(userInput).toLowerCase();
  const explicitTaskId = TASK_IDS.has(taskId) ? taskId : '';
  const resolvedTaskId = explicitTaskId || inferTaskId(text);
  const normalizedMeetingType = String(meetingType).toUpperCase();
  const explicitMeetingType = MEETING_TYPES.has(normalizedMeetingType)
    ? normalizedMeetingType
    : '';
  const resolvedMeetingType = explicitMeetingType || inferMeetingType(text);
  const needsClarification = !resolvedTaskId || !resolvedMeetingType;

  if (needsClarification) {
    return {
      taskId: '',
      stage: '',
      meetingType: '',
      meetingTypeSource: 'unresolved',
      needsClarification: true,
      clarificationQuestion: resolvedTaskId
        ? '此次交流属于首次沟通（A）、需求澄清（B），还是方案/Demo 推进（C）？'
        : '这项内容是用于会前准备、会中追问，还是会后复盘？'
    };
  }

  return {
    taskId: resolvedTaskId,
    stage: resolvedTaskId,
    meetingType: resolvedMeetingType,
    meetingTypeSource: explicitMeetingType ? 'explicit' : 'inferred',
    needsClarification: false,
    clarificationQuestion: ''
  };
}

export function recommendSopStep(scene, userInput = '') {
  const text = String(userInput).replace(/\s+/g, '');
  const candidates = (scene?.meetingTypes || []).flatMap((type) => (type.sopNodes || []).map((node) => ({ ...node, meetingType: type.id })));
  const exact = candidates.find((node) => text.includes(String(node.title || '').replace(/\s+/g, '')));
  if (exact) return { meetingType: exact.meetingType, stage: exact.stage, sopNodeId: exact.id, reason: `识别到步骤：${exact.title}` };
  const task = resolveMeetingTask({ userInput });
  if (!task.needsClarification) {
    const fallback = candidates.find((node) => node.meetingType === task.meetingType && node.stage === task.stage);
    if (fallback) return { meetingType: fallback.meetingType, stage: fallback.stage, sopNodeId: fallback.id, reason: `根据输入推荐 ${fallback.meetingType} 类 / ${stageLabel(fallback.stage)} / ${fallback.title}，请确认或修改。` };
  }
  return { meetingType: '', stage: '', sopNodeId: '', reason: '未能确定具体 SOP 步骤。' };
}

function stageLabel(stage) {
  return ({ before_meeting: '会前', during_meeting: '会中', after_meeting: '会后' })[stage] || '当前阶段';
}

function inferTaskId(text) {
  if (/会议纪要|会后|下一步|复盘|行动项/.test(text)) return 'after_meeting';
  if (/正在开会|客户刚说|接下来该问|会中/.test(text)) return 'during_meeting';
  if (/明天|下周|会前|准备会议|即将/.test(text)) return 'before_meeting';
  return '';
}

function inferMeetingType(text) {
  if (/首次|初次|了解需求|拜访/.test(text)) return 'A';
  if (/demo|poc|方案汇报|立项|决策/.test(text)) return 'C';
  if (/数据质量|数据条件|系统现状|试点|详细需求|数据.*(?:分散|口径|完整)/.test(text)) return 'B';
  return '';
}
