const MAX_LENGTH = 180;
const FIELD_RULES = {
  priorityQuestions: { min: 1, max: 5 },
  materials: { min: 1, max: 8 },
  riskReminders: { min: 1, max: 5 }
};

export function parseBattleCardProposal(answer) {
  const raw = String(answer || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw invalidProposal('模型未返回完整的作战卡候选。');
  let proposal;
  try { proposal = JSON.parse(raw.slice(start, end + 1)); } catch { throw invalidProposal('模型返回的作战卡候选格式异常，请重新生成。'); }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw invalidProposal('模型返回的作战卡候选格式异常，请重新生成。');
  const allowedKeys = new Set(['meetingGoal', ...Object.keys(FIELD_RULES)]);
  if (Object.keys(proposal).some((key) => !allowedKeys.has(key))) throw invalidProposal('模型返回了不支持的作战卡字段，请重新生成。');
  return {
    meetingGoal: text(proposal.meetingGoal, '会议目标'),
    priorityQuestions: list(proposal.priorityQuestions, '优先追问', FIELD_RULES.priorityQuestions),
    materials: list(proposal.materials, '建议携带材料', FIELD_RULES.materials),
    riskReminders: list(proposal.riskReminders, '补充风险提醒', FIELD_RULES.riskReminders)
  };
}

function text(value, label) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > MAX_LENGTH) throw invalidProposal(`${label}不能为空且不能超过 ${MAX_LENGTH} 个字符。`);
  return normalized;
}

function list(value, label, { min, max }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw invalidProposal(`${label}需包含 ${min}-${max} 条内容。`);
  const items = value.map((item) => text(item, label));
  if (new Set(items.map((item) => item.toLocaleLowerCase())).size !== items.length) throw invalidProposal(`${label}不能包含重复内容。`);
  return items;
}

function invalidProposal(message) {
  const error = new Error(message);
  error.code = 'INVALID_BATTLE_CARD_PROPOSAL';
  return error;
}
