import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBattleCardProposal } from '../src/battleCardProposal.js';

const validProposal = JSON.stringify({ meetingGoal: '确认客户当前场景、关键角色和下一步交流主题。', priorityQuestions: ['当前问题主要发生在哪个流程？'], materials: ['行业案例'], riskReminders: ['涉及交付范围时标记为待确认。'] });

test('parses a complete structured battle-card proposal', () => {
  assert.deepEqual(parseBattleCardProposal(validProposal), JSON.parse(validProposal));
});

test('rejects invalid, missing, excessive, or unsupported battle-card proposal fields', () => {
  assert.throws(() => parseBattleCardProposal('not json'), { code: 'INVALID_BATTLE_CARD_PROPOSAL' });
  assert.throws(() => parseBattleCardProposal('{"meetingGoal":"x"}'), { code: 'INVALID_BATTLE_CARD_PROPOSAL' });
  assert.throws(() => parseBattleCardProposal(JSON.stringify({ ...JSON.parse(validProposal), materials: Array(9).fill('材料') })), { code: 'INVALID_BATTLE_CARD_PROPOSAL' });
  assert.throws(() => parseBattleCardProposal(JSON.stringify({ ...JSON.parse(validProposal), extra: 'x' })), { code: 'INVALID_BATTLE_CARD_PROPOSAL' });
});
