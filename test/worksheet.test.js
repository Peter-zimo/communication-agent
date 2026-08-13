import test from 'node:test';
import assert from 'node:assert/strict';

import { applyExtractedWorksheetFields, createWorksheet, worksheetToMarkdown } from '../src/worksheet.js';

const node = {
  id: 'a_research',
  stage: 'before_meeting',
  title: '客户基础调研',
  mustDo: ['确认客户基础信息', '确认参会人与会议目标'],
  guardrails: ['不承诺未确认的产品能力']
};

test('creates one editable field for every must-do item', () => {
  const worksheet = createWorksheet('A', node);
  assert.deepEqual(worksheet.fields, [
    { label: '确认客户基础信息', value: '待确认', source: '需要用户补充' },
    { label: '确认参会人与会议目标', value: '待确认', source: '需要用户补充' }
  ]);
});

test('keeps only evidence-backed minute extraction and marks the rest pending', () => {
  const worksheet = applyExtractedWorksheetFields(createWorksheet('A', node), [
    { label: '确认客户基础信息', value: '客户为某制造企业' },
    { label: '不属于当前步骤', value: '不应出现' }
  ]);

  assert.equal(worksheet.fields[0].value, '客户为某制造企业');
  assert.equal(worksheet.fields[0].source, '信息来源于纪要');
  assert.equal(worksheet.fields[1].value, '待确认');
  assert.equal(worksheet.fields[1].source, '需要用户补充');
});

test('exports the final worksheet values as secondary-heading bullet lists', () => {
  const markdown = worksheetToMarkdown(applyExtractedWorksheetFields(createWorksheet('A', node), [
    { label: '确认客户基础信息', value: '客户为某制造企业' }
  ]));

  assert.match(markdown, /### 必做项\n- 确认客户基础信息：客户为某制造企业/);
  assert.match(markdown, /### 待确认信息\n- 确认参会人与会议目标/);
  assert.doesNotMatch(markdown, /\n1\. /);
});
