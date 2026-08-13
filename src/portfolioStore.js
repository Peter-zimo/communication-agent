import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS_FILE = path.join(ROOT, 'content', 'portfolio', 'projects.json');
const MEDIA_DIR = path.join(ROOT, 'public', 'portfolio-media');
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = new Set(['published', 'draft', 'coming_soon', 'archived']);
const LEGACY_MEDIA_REF = /^\/[a-z0-9][a-z0-9-]*\.(jpg|png|webp|mp4)$/;
const MANAGED_MEDIA_REF = /^\/portfolio-media\/([a-z0-9][a-z0-9-]*\.(jpg|png|webp|mp4))$/;
const MEDIA_FILE_NAME = /^[a-z0-9][a-z0-9-]*\.(jpg|png|webp|mp4)$/;
const POSTER_REF = /^\/(?:portfolio-media\/)?[a-z0-9][a-z0-9-]*\.(?:jpg|png|webp|svg)$/;
const DEFAULT_VIDEO_POSTER = '/portfolio-video-poster.svg';

export const MEDIA_LIMITS = {
  image: 20 * 1024 * 1024,
  video: 500 * 1024 * 1024
};

const ALLOWED_MEDIA = new Map([
  ['image/jpeg', { extension: '.jpg', limit: MEDIA_LIMITS.image, kind: 'image' }],
  ['image/png', { extension: '.png', limit: MEDIA_LIMITS.image, kind: 'image' }],
  ['image/webp', { extension: '.webp', limit: MEDIA_LIMITS.image, kind: 'image' }],
  ['video/mp4', { extension: '.mp4', limit: MEDIA_LIMITS.video, kind: 'video' }]
]);

const TEXT_FIELDS = {
  title: 120,
  summary: 500,
  role: 160,
  year: 20,
  value: 500,
  challenge: 500,
  delivery: 500
};

let writeQueue = Promise.resolve();

export async function readPortfolioProjects({ includeUnpublished = false } = {}) {
  const projects = await readProjects();
  return projects.filter((project) => includeUnpublished || project.status === 'published' || project.status === 'coming_soon');
}

export function validateProjectInput(input) {
  if (!input || typeof input !== 'object') throw new Error('案例数据不符合要求。');
  if (typeof input.id !== 'string' || !PROJECT_ID.test(input.id)) throw new Error('案例 ID 不符合要求。');
  if (!STATUSES.has(input.status)) throw new Error('案例状态不符合要求。');

  const project = { id: input.id, status: input.status };
  for (const [field, maxLength] of Object.entries(TEXT_FIELDS)) {
    project[field] = validateText(input[field], field, maxLength);
  }
  if (!Array.isArray(input.solutionSteps) || input.solutionSteps.length < 1 || input.solutionSteps.length > 6) {
    throw new Error('解决步骤数量不符合要求。');
  }
  project.solutionSteps = input.solutionSteps.map((step) => validateText(step, '解决步骤', 200));
  if (!Array.isArray(input.media)) throw new Error('媒体引用不符合要求。');
  project.media = input.media.map(validateMediaReference);
  return project;
}

export function validateMediaPart(part) {
  const rule = ALLOWED_MEDIA.get(part?.mimeType);
  const size = part?.buffer?.length ?? part?.size;
  const hasSource = Boolean(part?.buffer) || typeof part?.temporaryPath === 'string';
  if (!rule || !hasSource || !Number.isSafeInteger(size) || size < 0 || size > rule.limit) {
    throw new Error('媒体格式或大小不符合要求。');
  }
  return { ...rule, originalName: path.basename(part.originalName || '') };
}

export async function publishProject({ project, mediaParts }) {
  if (!Array.isArray(mediaParts)) throw new Error('媒体数据不符合要求。');
  const validatedProject = validateProjectInput(project);
  const validatedRules = mediaParts.map(validateMediaPart);
  const mediaMetadata = validateMediaMetadata(project?.mediaMetadata ?? project?.mediaAltText, mediaParts);
  const validatedParts = mediaParts.map((part, index) => ({
    part,
    rule: validatedRules[index],
    metadata: mediaMetadata[index]
  }));
  return serializeWrite(() => publishValidatedProject(validatedProject, validatedParts));
}

async function publishValidatedProject(validatedProject, validatedParts) {
  const projects = await readProjects();
  if (projects.some((item) => item.id === validatedProject.id)) throw new Error('案例 ID 已存在。');

  const createdPaths = [];
  try {
    const uploadedMedia = await storeUploadedMedia(validatedProject, validatedParts, createdPaths);
    const savedProject = validateProjectInput({ ...validatedProject, media: [...validatedProject.media, ...uploadedMedia] });
    await writeProjects([...projects, savedProject]);
    return savedProject;
  } catch (error) {
    await Promise.all(createdPaths.map((filePath) => rm(filePath, { force: true })));
    await discardTemporaryParts(validatedParts);
    throw error;
  }
}

export async function replaceProject({ project, mediaParts }) {
  if (!Array.isArray(mediaParts)) throw new Error('媒体数据不符合要求。');
  const validatedProject = validateProjectInput(project);
  const validatedRules = mediaParts.map(validateMediaPart);
  const mediaMetadata = validateMediaMetadata(project?.mediaMetadata ?? project?.mediaAltText, mediaParts);
  const validatedParts = mediaParts.map((part, index) => ({
    part,
    rule: validatedRules[index],
    metadata: mediaMetadata[index]
  }));
  return serializeWrite(() => replaceValidatedProject(validatedProject, validatedParts));
}

async function replaceValidatedProject(validatedProject, validatedParts) {
  const projects = await readProjects();
  const index = projects.findIndex((item) => item.id === validatedProject.id);
  if (index === -1) throw new Error('案例不存在。');

  const createdPaths = [];
  try {
    const uploadedMedia = await storeUploadedMedia(validatedProject, validatedParts, createdPaths);
    const savedProject = validateProjectInput({ ...validatedProject, media: [...validatedProject.media, ...uploadedMedia] });
    projects[index] = savedProject;
    await writeProjects(projects);
    return savedProject;
  } catch (error) {
    await Promise.all(createdPaths.map((filePath) => rm(filePath, { force: true })));
    await discardTemporaryParts(validatedParts);
    throw error;
  }
}

async function storeUploadedMedia(project, validatedParts, createdPaths) {
  await mkdir(MEDIA_DIR, { recursive: true });
  const stored = [];
  for (const { part, rule, metadata } of validatedParts) {
    const id = randomUUID();
    const fileName = `${id}${rule.extension}`;
    const mediaPath = path.join(MEDIA_DIR, fileName);
    if (part.temporaryPath) {
      await rename(part.temporaryPath, mediaPath);
      createdPaths.push(mediaPath);
    } else {
      const handle = await open(mediaPath, 'wx');
      createdPaths.push(mediaPath);
      try {
        await handle.writeFile(part.buffer);
      } finally {
        await handle.close();
      }
    }
    stored.push({
      id,
      fileName,
      url: `/portfolio-media/${fileName}`,
      mimeType: part.mimeType,
      kind: rule.kind,
      alt: metadata?.alt || rule.originalName || `${project.title} media`,
      caption: metadata?.caption || ''
    });
  }

  const posterMedium = [...project.media, ...stored].find((medium) => mediaKind(medium) === 'image');
  const posterUrl = mediaUrl(posterMedium) || DEFAULT_VIDEO_POSTER;
  return stored.map((medium) => medium.kind === 'video' ? { ...medium, posterUrl } : medium);
}

async function discardTemporaryParts(validatedParts) {
  await Promise.all(validatedParts
    .map(({ part }) => part?.temporaryPath)
    .filter(Boolean)
    .map((temporaryPath) => rm(temporaryPath, { force: true })));
}

export async function setProjectStatus(projectId, status) {
  if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) throw new Error('案例 ID 不符合要求。');
  if (!STATUSES.has(status)) throw new Error('案例状态不符合要求。');
  return serializeWrite(() => setValidatedProjectStatus(projectId, status));
}

async function setValidatedProjectStatus(projectId, status) {
  const projects = await readProjects();
  const index = projects.findIndex((project) => project.id === projectId);
  if (index === -1) throw new Error('案例不存在。');
  const updated = { ...projects[index], status };
  projects[index] = updated;
  await writeProjects(projects);
  return updated;
}

export async function deleteUnusedMedia(mediaId, { firstConfirmation = false, secondConfirmation = false } = {}) {
  const safeMediaId = validateMediaId(mediaId);
  const projects = await readProjects();
  if (projects.some((project) => project.media.some((medium) => mediaReferencesFile(medium, safeMediaId)))) {
    const error = new Error('媒体仍被案例引用，不能删除。');
    error.code = 'PORTFOLIO_MEDIA_REFERENCED';
    throw error;
  }
  await stat(path.join(MEDIA_DIR, safeMediaId));
  if (!firstConfirmation || !secondConfirmation) throw new Error('删除媒体需要二次确认。');
  await unlink(path.join(MEDIA_DIR, safeMediaId));
}

export async function readPortfolioMediaLibrary() {
  const [projects, entries] = await Promise.all([readProjects(), readdir(MEDIA_DIR, { withFileTypes: true })]);
  const referenced = new Map();
  for (const project of projects) {
    for (const medium of project.media) {
      const fileName = mediaFileName(medium);
      if (fileName) referenced.set(fileName, typeof medium === 'object' ? medium : null);
      const posterFile = posterFileName(medium);
      if (posterFile && !referenced.has(posterFile)) referenced.set(posterFile, null);
    }
  }
  return entries
    .filter((entry) => entry.isFile() && MEDIA_FILE_NAME.test(entry.name))
    .map((entry) => {
      const metadata = referenced.get(entry.name);
      const extension = path.extname(entry.name).toLowerCase();
      return {
        id: metadata?.id || entry.name.slice(0, -extension.length),
        fileName: entry.name,
        url: `/portfolio-media/${entry.name}`,
        kind: extension === '.mp4' ? 'video' : 'image',
        mimeType: metadata?.mimeType || mimeTypeForExtension(extension),
        alt: metadata?.alt || '',
        caption: metadata?.caption || '',
        posterUrl: metadata?.posterUrl,
        referenced: referenced.has(entry.name)
      };
    });
}

async function readProjects() {
  try {
    const text = await readFile(PROJECTS_FILE, 'utf8');
    const projects = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!Array.isArray(projects)) throw new Error('案例存储格式不符合要求。');
    return projects.map(validateProjectInput);
  } catch (error) {
    if (error?.code) throw error;
    const storageError = new Error('案例存储读取失败。');
    storageError.code = 'PORTFOLIO_STORAGE_READ_FAILED';
    throw storageError;
  }
}

function serializeWrite(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => {});
  return next;
}

async function writeProjects(projects) {
  const temporaryFile = path.join(path.dirname(PROJECTS_FILE), `.${path.basename(PROJECTS_FILE)}.${randomUUID()}.tmp`);
  let handle;
  let temporaryCreated = false;
  try {
    handle = await open(temporaryFile, 'wx');
    temporaryCreated = true;
    await handle.writeFile(`${JSON.stringify(projects, null, 2)}\n`, 'utf8');
    await handle.close();
    handle = undefined;
    await rename(temporaryFile, PROJECTS_FILE);
  } catch (error) {
    await handle?.close().catch(() => {});
    if (temporaryCreated) await rm(temporaryFile, { force: true });
    throw error;
  }
}

function validateText(value, field, maxLength) {
  if (typeof value !== 'string') throw new Error(`${field} 不符合要求。`);
  const text = value.trim();
  if (!text || text.length > maxLength || /[<>\u0000-\u001f]/.test(text)) throw new Error(`${field} 不符合要求。`);
  return text;
}

function validateOptionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return '';
  return validateText(value, field, maxLength);
}

function validateMediaMetadata(value, mediaParts) {
  if (value === undefined) {
    if (mediaParts.length) throw new Error('媒体替代文字不符合要求。');
    return [];
  }
  if (!Array.isArray(value) || value.length !== mediaParts.length) throw new Error('媒体说明不符合要求。');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || path.basename(String(item.name || '')) !== path.basename(mediaParts[index]?.originalName || '')) {
      throw new Error('媒体说明不符合要求。');
    }
    return {
      alt: validateText(item.alt, '媒体替代文字', 200),
      caption: validateOptionalText(item.caption, '媒体说明', 500)
    };
  });
}

function validateMediaReference(medium) {
  if (typeof medium === 'string') {
    if (!LEGACY_MEDIA_REF.test(medium) && !MANAGED_MEDIA_REF.test(medium)) throw new Error('媒体引用不符合要求。');
    return medium;
  }
  if (!medium || typeof medium !== 'object') throw new Error('媒体引用不符合要求。');
  const id = String(medium.id || '');
  const fileName = String(medium.fileName || '');
  const url = String(medium.url || '');
  if (!PROJECT_ID.test(id) || !MEDIA_FILE_NAME.test(fileName) || fileName !== `${id}${path.extname(fileName)}`) {
    throw new Error('媒体引用不符合要求。');
  }
  const rule = ALLOWED_MEDIA.get(medium.mimeType);
  const managedMatch = url.match(MANAGED_MEDIA_REF);
  const legacyMatch = url.match(LEGACY_MEDIA_REF);
  if (!rule || rule.kind !== medium.kind || path.extname(fileName) !== rule.extension
    || (managedMatch?.[1] !== fileName && !(legacyMatch && url.slice(1) === fileName))) {
    throw new Error('媒体引用不符合要求。');
  }
  const result = {
    id,
    fileName,
    url,
    mimeType: medium.mimeType,
    kind: medium.kind,
    alt: validateText(medium.alt, '媒体替代文字', 200),
    caption: validateOptionalText(medium.caption, '媒体说明', 500)
  };
  if (medium.kind === 'video') {
    if (typeof medium.posterUrl !== 'string' || !POSTER_REF.test(medium.posterUrl)) throw new Error('视频封面不符合要求。');
    result.posterUrl = medium.posterUrl;
  }
  return result;
}

function validateMediaId(mediaId) {
  if (typeof mediaId !== 'string' || !MEDIA_FILE_NAME.test(mediaId)) throw new Error('媒体 ID 不符合要求。');
  return mediaId;
}

function mediaFileName(medium) {
  if (typeof medium === 'object' && medium) return medium.fileName;
  const managed = String(medium || '').match(MANAGED_MEDIA_REF);
  return managed?.[1] || String(medium || '').replace(/^\//, '');
}

function posterFileName(medium) {
  if (!medium || typeof medium !== 'object') return '';
  return String(medium.posterUrl || '').match(MANAGED_MEDIA_REF)?.[1] || '';
}

function mediaReferencesFile(medium, fileName) {
  return mediaFileName(medium) === fileName || posterFileName(medium) === fileName;
}

function mediaKind(medium) {
  if (typeof medium === 'object' && medium) return medium.kind;
  return /\.mp4$/i.test(String(medium || '')) ? 'video' : 'image';
}

function mediaUrl(medium) {
  return typeof medium === 'object' && medium ? medium.url : medium;
}

function mimeTypeForExtension(extension) {
  if (extension === '.jpg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'video/mp4';
}
