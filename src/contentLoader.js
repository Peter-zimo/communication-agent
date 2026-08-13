import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const SCENES_DIR = path.join(CONTENT_DIR, 'scenes');
const DEFAULT_SCENE_ID = 'customer_communication';

export async function loadContent(sceneId = DEFAULT_SCENE_ID) {
  const sourceDir = await resolveContentDir(sceneId);
  const [scene, questions, playbookConfig, executionConfig, skillPrompt, before, during, after] = await Promise.all([
    readJson(sourceDir, 'scene_config.json'),
    readJson(sourceDir, 'recommended_questions.json'),
    readJson(sourceDir, 'meeting_playbooks.json'),
    readJson(sourceDir, 'execution_config.json'),
    readText(sourceDir, path.join('source', 'customer_communication_skill.md')),
    readText(sourceDir, path.join('templates', 'customer_communication_before.md')),
    readText(sourceDir, path.join('templates', 'customer_communication_during.md')),
    readText(sourceDir, path.join('templates', 'customer_communication_after.md'))
  ]);

  validateSceneContent(scene, questions);

  const { reviewTemplate, ...playbooks } = playbookConfig;

  return {
    sourceDir,
    scene,
    questions,
    playbooks,
    reviewTemplate,
    executionConfig,
    skillPrompt,
    templates: {
      before_meeting: before,
      during_meeting: during,
      after_meeting: after
    }
  };
}

async function resolveContentDir(sceneId) {
  const sceneDir = path.join(SCENES_DIR, sceneId);
  if (await pathExists(path.join(sceneDir, 'scene_config.json'))) return sceneDir;
  throw new Error(`Unknown scene content package: ${sceneId}`);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(baseDir, relativePath) {
  const text = await readText(baseDir, relativePath);
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

async function readText(baseDir, relativePath) {
  return readFile(path.join(baseDir, relativePath), 'utf8');
}

function validateSceneContent(scene, questions) {
  const allowedStages = new Set(['before_meeting', 'during_meeting', 'after_meeting']);
  const typeIds = new Set((scene.meetingTypes || []).map((type) => type.id));
  for (const required of ['A', 'B', 'C']) {
    if (!typeIds.has(required)) throw new Error(`Missing meeting type: ${required}`);
    const type = scene.meetingTypes.find((item) => item.id === required);
    if (!Array.isArray(type.intakeSchema) || type.intakeSchema.length === 0) {
      throw new Error(`Missing intake schema for meeting type: ${required}`);
    }
    if (!Array.isArray(type.sopNodes) || type.sopNodes.length === 0) {
      throw new Error(`Missing SOP nodes for meeting type: ${required}`);
    }
    for (const node of type.sopNodes) {
      if (!allowedStages.has(node.stage)) {
        throw new Error(`Invalid or missing SOP node stage: ${required}/${node.id}`);
      }
    }
  }

  if (!questions?.byMeetingType?.A || !questions?.byMeetingType?.B || !questions?.byMeetingType?.C) {
    throw new Error('Missing type-specific recommended questions.');
  }
}
