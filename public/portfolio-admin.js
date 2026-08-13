import {
  archiveRequest,
  beginMediaDeletion,
  confirmedMediaDeletion,
  prepareLocalMediaSelection,
  revokeLocalMediaSelection,
  validateProjectDraft
} from './portfolio-admin-helpers.js';

const projectForm = document.getElementById('projectForm');
const mediaInput = document.getElementById('mediaInput');
const solutionSteps = document.getElementById('solutionSteps');
const selectedMedia = document.getElementById('selectedMedia');
const existingMedia = document.getElementById('existingMedia');
const adminProjectList = document.getElementById('adminProjectList');
const adminMediaLibrary = document.getElementById('adminMediaLibrary');
const adminStatus = document.getElementById('adminStatus');
const livePreview = document.getElementById('livePreview');
const deleteMediaDialog = document.getElementById('deleteMediaDialog');
const deleteMediaMessage = document.getElementById('deleteMediaMessage');

let projects = [];
let mediaLibrary = [];
let editingId = null;
let existingMediaPaths = [];
let selectedFiles = [];
let pendingDeleteMediaId = null;

function textElement(tagName, text, className) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function setStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.classList.toggle('admin-error', isError);
}

function fileKind(file) {
  return file.type === 'video/mp4' ? 'video' : 'image';
}

function revokePreviewUrls() {
  revokeLocalMediaSelection(selectedFiles, URL);
}

function replaceSelectedMedia(files) {
  const { items, errors } = prepareLocalMediaSelection(selectedFiles, files, URL);
  selectedFiles = items;
  renderSelectedMedia();
  renderPreview();
  if (errors.length) setStatus(errors.join(' '), true);
}

function addSolutionStep(value = '') {
  if (solutionSteps.children.length >= 6) return;
  const row = document.createElement('div');
  row.className = 'solution-step-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.required = true;
  input.maxLength = 200;
  input.value = value;
  input.setAttribute('aria-label', `解决方案步骤 ${solutionSteps.children.length + 1}`);
  input.addEventListener('input', renderPreview);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = '删除步骤';
  remove.addEventListener('click', () => {
    if (solutionSteps.children.length === 1) return;
    row.remove();
    renderPreview();
  });
  row.append(input, remove);
  solutionSteps.append(row);
}

function renderSelectedMedia() {
  selectedMedia.replaceChildren();
  for (const [index, item] of selectedFiles.entries()) {
    const row = document.createElement('div');
    row.className = 'media-row';
    const description = textElement('p', `${item.file.name}（${fileKind(item.file) === 'video' ? '视频' : '图片'}）`);
    const altLabel = document.createElement('label');
    altLabel.textContent = '媒体替代文字';
    const altInput = document.createElement('input');
    altInput.type = 'text';
    altInput.required = true;
    altInput.maxLength = 200;
    altInput.value = item.alt;
    altInput.setAttribute('aria-label', `${item.file.name} 的媒体替代文字`);
    altInput.addEventListener('input', () => {
      selectedFiles[index].alt = altInput.value;
      renderPreview();
    });
    const captionLabel = document.createElement('label');
    captionLabel.textContent = '媒体说明（可选）';
    const captionInput = document.createElement('input');
    captionInput.type = 'text';
    captionInput.maxLength = 500;
    captionInput.value = item.caption;
    captionInput.addEventListener('input', () => {
      selectedFiles[index].caption = captionInput.value;
      renderPreview();
    });
    captionLabel.append(captionInput);
    altLabel.append(altInput);
    row.append(description, altLabel, captionLabel);
    selectedMedia.append(row);
  }
}

function mediaName(path) {
  if (typeof path === 'object' && path) return path.fileName;
  return String(path).replace(/^\/portfolio-media\//, '').replace(/^\//, '');
}

function renderExistingMedia() {
  existingMedia.replaceChildren();
  if (!existingMediaPaths.length) return;
  existingMedia.append(textElement('p', '已保留的媒体：'));
  for (const path of existingMediaPaths) {
    const row = document.createElement('div');
    row.className = 'media-row existing-media-row';
    row.append(textElement('span', mediaName(path)));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '从案例移除';
    remove.addEventListener('click', () => {
      existingMediaPaths = existingMediaPaths.filter((item) => item !== path);
      renderExistingMedia();
      renderPreview();
    });
    row.append(remove);
    existingMedia.append(row);
  }
}

function formText(name) {
  return String(projectForm.elements[name].value || '').trim();
}

function projectFromForm() {
  const steps = [...solutionSteps.querySelectorAll('input')].map((input) => input.value.trim());
  const project = {
    id: editingId || formText('projectId'),
    status: formText('status'),
    title: formText('title'),
    summary: formText('summary'),
    role: formText('role'),
    year: formText('year'),
    value: formText('value'),
    challenge: formText('challenge'),
    delivery: formText('delivery'),
    solutionSteps: steps,
    media: existingMediaPaths,
    mediaMetadata: selectedFiles.map((item) => ({ name: item.file.name, alt: item.alt.trim(), caption: item.caption.trim() }))
  };
  const error = validateProjectDraft(project);
  if (error) throw new Error(error);
  return project;
}

function renderPreview() {
  livePreview.replaceChildren();
  const title = formText('title') || '案例标题';
  const summary = formText('summary') || '填写摘要后在这里预览。';
  livePreview.append(textElement('p', `${formText('year') || '年份'} / ${formText('role') || '角色'}`, 'case-meta'));
  livePreview.append(textElement('h3', title), textElement('p', summary, 'project-summary'));
  const steps = [...solutionSteps.querySelectorAll('input')].map((input) => input.value.trim()).filter(Boolean);
  if (steps.length) {
    const list = document.createElement('ol');
    for (const step of steps) list.append(textElement('li', step));
    livePreview.append(list);
  }
  for (const item of selectedFiles) {
    if (fileKind(item.file) === 'image') {
      const image = document.createElement('img');
      image.src = item.url;
      image.alt = item.alt;
      livePreview.append(image);
    } else {
      const video = document.createElement('video');
      video.src = item.url;
      video.controls = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', item.alt || item.file.name);
      livePreview.append(video);
    }
    if (item.caption) livePreview.append(textElement('p', item.caption, 'media-caption'));
  }
}

function renderProjectList() {
  adminProjectList.replaceChildren();
  for (const project of projects) {
    const card = document.createElement('article');
    card.className = 'admin-project-card';
    card.append(textElement('h3', project.title), textElement('p', `${project.status} / ${project.year}`));
    const actions = document.createElement('div');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => editProject(project));
    actions.append(edit);
    if (project.status !== 'archived') {
      const archive = document.createElement('button');
      archive.type = 'button';
      archive.textContent = '下架';
      archive.addEventListener('click', () => archiveProject(project.id));
      actions.append(archive);
    }
    for (const path of project.media) {
      const deleteMedia = document.createElement('button');
      deleteMedia.type = 'button';
      deleteMedia.textContent = `删除媒体 ${mediaName(path)}`;
      deleteMedia.addEventListener('click', () => requestMediaDeletion(path));
      actions.append(deleteMedia);
    }
    card.append(actions);
    adminProjectList.append(card);
  }
}

function renderMediaLibrary() {
  adminMediaLibrary.replaceChildren();
  for (const medium of mediaLibrary) {
    const row = document.createElement('div');
    row.className = 'media-row existing-media-row';
    row.append(
      textElement('span', medium.fileName),
      textElement('span', medium.referenced ? '案例正在引用' : '未引用，可删除')
    );
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除媒体';
    remove.disabled = medium.referenced;
    remove.addEventListener('click', () => requestMediaDeletion(medium.fileName));
    row.append(remove);
    adminMediaLibrary.append(row);
  }
}

async function loadProjects() {
  const response = await fetch('/api/portfolio/projects?include=all');
  if (!response.ok) throw new Error('无法读取已有案例。');
  const payload = await response.json();
  if (!Array.isArray(payload.projects)) throw new Error('案例数据格式不正确。');
  projects = payload.projects;
  renderProjectList();
}

async function loadMediaLibrary() {
  const response = await fetch('/api/portfolio/media');
  if (!response.ok) throw new Error('无法读取媒体库。');
  const payload = await response.json();
  if (!Array.isArray(payload.media)) throw new Error('媒体库数据格式不正确。');
  mediaLibrary = payload.media;
  renderMediaLibrary();
}

function editProject(project) {
  resetEditor();
  editingId = project.id;
  projectForm.elements.projectId.value = project.id;
  projectForm.elements.projectId.readOnly = true;
  for (const field of ['status', 'title', 'summary', 'role', 'year', 'value', 'challenge', 'delivery']) {
    projectForm.elements[field].value = project[field] || '';
  }
  solutionSteps.replaceChildren();
  for (const step of project.solutionSteps) addSolutionStep(step);
  existingMediaPaths = [...project.media];
  renderExistingMedia();
  renderPreview();
  setStatus(`正在编辑：${project.title}`);
}

function resetEditor() {
  revokePreviewUrls();
  selectedFiles = [];
  editingId = null;
  existingMediaPaths = [];
  projectForm.reset();
  projectForm.elements.projectId.readOnly = false;
  mediaInput.value = '';
  solutionSteps.replaceChildren();
  addSolutionStep();
  renderSelectedMedia();
  renderExistingMedia();
  renderPreview();
}

async function archiveProject(projectId) {
  setStatus('正在下架案例…');
  try {
    const { url, options } = archiveRequest(projectId);
    const response = await fetch(url, options);
    if (!response.ok) throw new Error((await response.json()).errorMessage || '下架失败。');
    await loadProjects();
    setStatus('案例已下架。');
  } catch (error) {
    setStatus(error.message || '下架失败。', true);
  }
}

function requestMediaDeletion(path) {
  const mediaId = mediaName(path);
  pendingDeleteMediaId = null;
  deleteMediaMessage.textContent = `确认删除 ${mediaId}？删除后无法恢复；仍被案例引用的媒体会保留。`;
  pendingDeleteMediaId = beginMediaDeletion(deleteMediaDialog, mediaId);
}

async function deleteMedia(mediaId) {
  if (!mediaId) return;
  setStatus('正在删除媒体…');
  try {
    const response = await fetch(`/api/portfolio/media/${mediaId}`, {
      method: 'DELETE',
      headers: { 'X-Portfolio-Delete-Confirm': 'delete' }
    });
    if (response.status === 409) {
      setStatus('媒体仍被案例引用，已保留。', true);
      return;
    }
    if (!response.ok) throw new Error((await response.json()).errorMessage || '删除媒体失败。');
    await Promise.all([loadProjects(), loadMediaLibrary()]);
    setStatus('媒体已删除。');
  } catch (error) {
    setStatus(error.message || '删除媒体失败。', true);
  }
}

projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (!projectForm.reportValidity()) return;
    const project = projectFromForm();
    const formData = new FormData();
    formData.append('project', JSON.stringify(project));
    for (const { file } of selectedFiles) formData.append('media', file, file.name);
    const endpoint = editingId ? `/api/portfolio/projects/${editingId}` : '/api/portfolio/projects';
    setStatus('正在保存案例…');
    const response = await fetch(endpoint, { method: editingId ? 'PUT' : 'POST', body: formData });
    if (!response.ok) throw new Error((await response.json()).errorMessage || '保存案例失败。');
    await Promise.all([loadProjects(), loadMediaLibrary()]);
    resetEditor();
    setStatus('案例已保存。');
  } catch (error) {
    setStatus(error.message || '保存案例失败，请检查字段后重试。', true);
  }
});

mediaInput.addEventListener('change', () => replaceSelectedMedia(mediaInput.files));
document.getElementById('addSolutionStep').addEventListener('click', () => {
  addSolutionStep();
  renderPreview();
});
document.getElementById('newProjectButton').addEventListener('click', resetEditor);
document.getElementById('resetProjectButton').addEventListener('click', () => window.setTimeout(resetEditor, 0));
projectForm.addEventListener('input', renderPreview);
for (const button of document.querySelectorAll('[data-preview-mode]')) {
  button.addEventListener('click', () => {
    livePreview.dataset.mode = button.dataset.previewMode;
    for (const item of document.querySelectorAll('[data-preview-mode]')) {
      item.setAttribute('aria-pressed', String(item === button));
    }
  });
}
deleteMediaDialog.addEventListener('close', () => {
  const mediaId = confirmedMediaDeletion(deleteMediaDialog, pendingDeleteMediaId);
  pendingDeleteMediaId = null;
  if (mediaId) deleteMedia(mediaId);
});
window.addEventListener('beforeunload', revokePreviewUrls);

resetEditor();
Promise.all([loadProjects(), loadMediaLibrary()])
  .catch((error) => setStatus(error.message || '无法读取已有案例。', true));
