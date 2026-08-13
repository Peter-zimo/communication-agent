const IMAGE_LIMIT = 20 * 1024 * 1024;
const VIDEO_LIMIT = 500 * 1024 * 1024;
const ACCEPTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);

export function validateMediaFile(file) {
  if (!ACCEPTED_MEDIA_TYPES.has(file.type)) return '媒体格式必须是 JPEG、PNG、WebP 或 MP4。';
  const maximum = file.type === 'video/mp4' ? VIDEO_LIMIT : IMAGE_LIMIT;
  if (file.size > maximum) return file.type === 'video/mp4' ? '单个视频不能超过 500MB。' : '单个图片不能超过 20MB。';
  return '';
}

export function revokeLocalMediaSelection(items, urlApi) {
  for (const item of items) urlApi.revokeObjectURL(item.url);
}

export function prepareLocalMediaSelection(previousItems, files, urlApi) {
  revokeLocalMediaSelection(previousItems, urlApi);
  const items = [];
  const errors = [];
  for (const file of files) {
    const error = validateMediaFile(file);
    if (error) {
      errors.push(`${file.name}：${error}`);
      continue;
    }
    items.push({ file, url: urlApi.createObjectURL(file), alt: '', caption: '' });
  }
  return { items, errors };
}

export function validateProjectDraft(project) {
  const mediaMetadata = project.mediaMetadata ?? project.mediaAltText;
  const requiredFields = ['title', 'summary', 'role', 'year', 'value', 'challenge', 'delivery'];
  if (requiredFields.some((field) => !String(project[field] || '').trim())) return '请填写所有案例文字字段。';
  if (!Array.isArray(project.solutionSteps) || project.solutionSteps.length < 1 || project.solutionSteps.length > 6 || project.solutionSteps.some((step) => !String(step).trim())) {
    return '请填写 1 到 6 条解决方案步骤。';
  }
  if (!Array.isArray(mediaMetadata) || mediaMetadata.some((item) => !String(item.alt || '').trim())) return '请为每个新媒体文件填写替代文字。';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(project.id || ''))) return '案例 ID 仅能使用小写字母、数字和连字符。';
  return '';
}

export function archiveRequest(projectId) {
  return {
    url: `/api/portfolio/projects/${projectId}/status`,
    options: {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' })
    }
  };
}

export function beginMediaDeletion(dialog, mediaId) {
  dialog.returnValue = '';
  dialog.showModal();
  return mediaId;
}

export function confirmedMediaDeletion(dialog, mediaId) {
  return dialog.returnValue === 'confirm' && mediaId ? mediaId : '';
}
