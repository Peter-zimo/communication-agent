import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseCustomerMarkdown, buildCustomerMarkdown, listCustomers, readCustomerHistory, saveCustomerHistory } from '../src/customerStore.js';

/* ─── parseCustomerMarkdown ─── */

test('parseCustomerMarkdown extracts frontmatter fields and body', () => {
  const text = [
    '---',
    '客户: XX集团',
    '行业: 制造业',
    '会议类型: A',
    '阶段: 初步交流',
    '---',
    '## 会后总结',
    '- 客户对 AI 检测准确率有顾虑',
    '- 预算窗口在 Q4',
    '',
    '## 待办',
    '- [ ] 8/20 前提供 PoC 方案'
  ].join('\n');

  const result = parseCustomerMarkdown(text);
  assert.equal(result.frontmatter.客户, 'XX集团');
  assert.equal(result.frontmatter.行业, '制造业');
  assert.equal(result.frontmatter['会议类型'], 'A');
  assert.equal(result.frontmatter.阶段, '初步交流');
  assert.match(result.body, /会后总结/);
  assert.match(result.body, /PoC 方案/);
});

test('parseCustomerMarkdown handles missing frontmatter gracefully', () => {
  const result = parseCustomerMarkdown('## 没有 frontmatter 的文件\n- 内容');
  assert.deepEqual(result.frontmatter, {});
  assert.match(result.body, /没有 frontmatter 的文件/);
});

test('parseCustomerMarkdown handles empty input', () => {
  const result = parseCustomerMarkdown('');
  assert.deepEqual(result.frontmatter, {});
  assert.equal(result.body, '');
});

/* ─── buildCustomerMarkdown ─── */

test('buildCustomerMarkdown generates correct markdown with frontmatter and body', () => {
  const md = buildCustomerMarkdown({
    frontmatter: {
      '客户': 'XX集团',
      '行业': '制造业',
      '会议类型': 'A',
      '阶段': '初步交流',
      '决策人': '张总',
      '上次交流': '2026-08-18'
    },
    body: [
      '## 会后总结',
      '- 客户对准确率有顾虑',
      '',
      '## 待办',
      '- [ ] 8/20 前提供 PoC 方案'
    ].join('\n')
  });

  assert.match(md, /^---\n/);
  assert.match(md, /客户: XX集团/);
  assert.match(md, /行业: 制造业/);
  assert.match(md, /决策人: 张总/);
  assert.match(md, /---\n\n## 会后总结/);
  assert.match(md, /PoC 方案/);
});

test('buildCustomerMarkdown roundtrips through parseCustomerMarkdown', () => {
  const original = {
    frontmatter: { '客户': '往返测试', '会议类型': 'C', '阶段': '方案汇报' },
    body: '## 会后总结\n- 测试内容\n\n## 待办\n- [ ] 完成方案'
  };
  const md = buildCustomerMarkdown(original);
  const parsed = parseCustomerMarkdown(md);

  assert.equal(parsed.frontmatter['客户'], '往返测试');
  assert.equal(parsed.frontmatter['会议类型'], 'C');
  assert.match(parsed.body, /测试内容/);
  assert.match(parsed.body, /完成方案/);
});

/* ─── listCustomers ─── */

test('listCustomers returns an array', async () => {
  const customers = await listCustomers();
  assert.ok(Array.isArray(customers));
});

/* ─── saveCustomerHistory + readCustomerHistory roundtrip ─── */

test('saveCustomerHistory and readCustomerHistory roundtrip', async () => {
  const data = {
    frontmatter: {
      '客户': '测试客户记忆',
      '会议类型': 'A',
      '阶段': '初步交流',
      '上次交流': '2026-08-18'
    },
    body: '## 会后总结\n- 测试内容'
  };

  await saveCustomerHistory('测试客户记忆', data);
  const result = await readCustomerHistory('测试客户记忆');

  assert.ok(result, '应能找到刚保存的客户');
  assert.equal(result.frontmatter['客户'], '测试客户记忆');
  assert.equal(result.frontmatter['会议类型'], 'A');
  assert.match(result.body, /测试内容/);
});

test('readCustomerHistory returns null for unknown customer', async () => {
  const result = await readCustomerHistory('不存在的客户xyz123');
  assert.equal(result, null);
});

test('saveCustomerHistory overwrites existing file for same customer and type', async () => {
  const data1 = {
    frontmatter: { '客户': '覆写测试记忆', '会议类型': 'B', '阶段': '意向交流' },
    body: '## 第一次\n- 第一次内容'
  };
  const data2 = {
    frontmatter: { '客户': '覆写测试记忆', '会议类型': 'B', '阶段': '意向交流' },
    body: '## 第二次\n- 更新内容'
  };

  await saveCustomerHistory('覆写测试记忆', data1);
  await saveCustomerHistory('覆写测试记忆', data2);
  const result = await readCustomerHistory('覆写测试记忆');

  assert.ok(result);
  assert.match(result.body, /更新内容/);
  assert.doesNotMatch(result.body, /第一次内容/);
});
