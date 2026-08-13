import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTaskResultDocx } from '../src/docxExporter.js';

test('exports Markdown headings and bullets as a non-empty DOCX buffer', async () => {
  const file = await exportTaskResultDocx({
    title: '会后复盘与下一步跟进',
    markdown: '## 1. 对内复盘\n### 1.1 本次交流结论\n- 客户认可方向。\n## 2. 对外跟进\n### 2.1 我方行动项\n- 确认 Demo 范围。'
  });

  assert.ok(Buffer.isBuffer(file));
  assert.ok(file.length > 500);
  assert.equal(file.subarray(0, 2).toString(), 'PK');
});
