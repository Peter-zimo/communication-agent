import test from 'node:test';
import assert from 'node:assert/strict';

import { loadContent } from '../src/contentLoader.js';

test('loadContent exposes A/B/C meeting playbooks and after-meeting review template', async () => {
  const content = await loadContent();

  assert.equal(content.playbooks.A.name, '初步宽泛交流');
  assert.deepEqual(
    content.playbooks.A.stages.map((stage) => stage.id),
    ['before_meeting', 'during_meeting', 'after_meeting']
  );
  assert.ok(content.playbooks.A.stages[0].sections.some((section) => section.title === '必做项'));
  assert.equal(content.playbooks.B.name, '意向方向深入交流');
  assert.equal(content.playbooks.C.name, '方案汇报推进交流');
  assert.ok(content.reviewTemplate.items.includes('客户关键原话'));
});
