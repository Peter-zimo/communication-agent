import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { listCustomers, readCustomerHistory, saveCustomerHistory } from '../src/customerStore.js';

test('server file imports customerStore', async () => {
  const server = await readFile('src/server.js', 'utf8');
  assert.match(server, /customerStore/);
  assert.match(server, /listCustomers|readCustomerHistory/);
});

test('GET /api/customers route exists in server', async () => {
  const server = await readFile('src/server.js', 'utf8');
  assert.match(server, /\/api\/customers/);
});

test('GET /api/customers/:name/history route exists in server', async () => {
  const server = await readFile('src/server.js', 'utf8');
  assert.ok(server.includes('customerHistoryMatch'));
  assert.match(server, /api\/customers/);
  assert.match(server, /history/);
});

test('listCustomers returns array of objects with name field', async () => {
  const customers = await listCustomers();
  assert.ok(Array.isArray(customers));
  for (const c of customers) {
    assert.ok(typeof c.name === 'string');
    assert.ok(typeof c.file === 'string');
    assert.ok(typeof c.updatedAt === 'string');
  }
});

test('readCustomerHistory returns frontmatter and body', async () => {
  // 先确保有一个测试客户
  await saveCustomerHistory('路由测试客户', {
    frontmatter: { '会议类型': 'A', '阶段': '初步交流' },
    body: '## 会后总结\n- 路由测试内容'
  });

  const result = await readCustomerHistory('路由测试客户');
  assert.ok(result);
  assert.equal(result.frontmatter['客户'], '路由测试客户');
  assert.match(result.body, /路由测试内容/);
});
