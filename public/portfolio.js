'use strict';

const projectList = document.getElementById('projectList');
const projectStatus = document.getElementById('projectStatus');
const caseReader = document.getElementById('caseReader');
const caseContent = document.getElementById('caseContent');
const imageDialog = document.getElementById('imageDialog');
const dialogImage = document.getElementById('dialogImage');
const closeImageDialog = document.getElementById('closeImageDialog');

let projects = [];

function textElement(tagName, text, className) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function localMediaPath(value) {
  const url = typeof value === 'object' && value ? value.url : value;
  return typeof url === 'string' && /^\/(?:portfolio-media\/)?[a-z0-9][a-z0-9-]*\.(?:jpg|png|webp|mp4)$/i.test(url);
}

function mediaKind(media) {
  if (typeof media === 'object' && media?.kind) return media.kind;
  return /\.mp4$/i.test(String(media || '')) ? 'video' : 'image';
}

function mediaUrl(media) {
  return typeof media === 'object' && media ? media.url : media;
}

function describedMedia(media, project, index) {
  if (typeof media === 'object' && media) return media;
  return {
    url: media,
    kind: mediaKind(media),
    alt: `${project.title} 案例媒体 ${index + 1}`,
    caption: '',
    posterUrl: mediaKind(media) === 'video' ? '/portfolio-video-poster.svg' : undefined
  };
}

async function loadProjects() {
  const response = await fetch('/api/portfolio/projects');
  if (!response.ok) throw new Error('作品集暂时无法加载。');
  const payload = await response.json();
  if (!Array.isArray(payload.projects)) throw new Error('作品集数据格式不正确。');
  return payload.projects;
}

function createProjectCard(project, index) {
  const card = document.createElement('article');
  card.className = 'project-card';

  const number = textElement('p', String(index + 1).padStart(2, '0'), 'project-number');
  const title = document.createElement('h3');
  title.textContent = project.title;
  const summary = textElement('p', project.summary, 'project-summary');
  const metadata = textElement('p', `${project.role} · ${project.year}`, 'project-meta');
  card.append(number, title, summary, metadata);

  if (project.status === 'published') {
    const featuredVideo = project.media.find((medium) => localMediaPath(medium) && mediaKind(medium) === 'video');
    if (featuredVideo) {
      const describedVideo = describedMedia(featuredVideo, project, project.media.indexOf(featuredVideo));
      if (describedVideo.posterUrl) {
        const poster = document.createElement('img');
        poster.className = 'project-video-poster';
        poster.src = describedVideo.posterUrl;
        poster.alt = describedVideo.alt;
        card.append(poster);
      }
      const videoEntry = document.createElement('button');
      videoEntry.type = 'button';
      videoEntry.className = 'text-link video-entry';
      videoEntry.textContent = '观看演示视频';
      videoEntry.addEventListener('click', () => openCaseReader(project.id, true));
      card.append(videoEntry);
    }
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'text-link';
    openButton.textContent = '阅读案例';
    openButton.addEventListener('click', () => openCaseReader(project.id));
    card.append(openButton);
  } else {
    card.append(textElement('p', '即将发布', 'coming-soon'));
  }
  return card;
}

function renderProjectCards() {
  projectList.replaceChildren(...projects.map(createProjectCard));
  projectStatus.hidden = true;
}

function createVideo(media, project) {
  const mediaSection = document.createElement('section');
  mediaSection.className = 'case-media';
  mediaSection.append(textElement('h4', '演示视频'));
  const video = document.createElement('video');
  video.preload = 'none';
  video.controls = true;
  video.autoplay = false;
  video.setAttribute('playsinline', '');
  video.poster = media.posterUrl;
  video.setAttribute('aria-label', media.alt || `${project.title} 演示视频`);

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'video-start';
  startButton.textContent = '点击开始播放';
  startButton.addEventListener('click', async () => {
    if (!video.src) video.src = media.url;
    try {
      await video.play();
      startButton.hidden = true;
    } catch {
      startButton.textContent = '请使用视频控件开始播放';
    }
  });
  mediaSection.append(startButton, video);
  if (media.caption) mediaSection.append(textElement('p', media.caption, 'media-caption'));
  return mediaSection;
}

function openImageDialog(media, project, index) {
  dialogImage.src = mediaUrl(media);
  dialogImage.alt = `${project.title} 案例图片 ${index + 1}`;
  if (typeof media === 'object' && media.alt) dialogImage.alt = media.alt;
  imageDialog.showModal();
  closeImageDialog.focus();
}

function createImageGallery(imageMedia, project) {
  const gallery = document.createElement('section');
  gallery.className = 'case-media';
  gallery.append(textElement('h4', '关键体验'));
  const list = document.createElement('div');
  list.className = 'image-gallery';
  for (const [index, media] of imageMedia.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-trigger';
    button.textContent = media.caption || `查看案例图片 ${index + 1}`;
    button.setAttribute('aria-label', `查看${project.title}案例图片 ${index + 1}`);
    if (media.alt) button.setAttribute('aria-label', media.alt);
    button.addEventListener('click', () => openImageDialog(media, project, index));
    list.append(button);
  }
  gallery.append(list);
  return gallery;
}

function createNavigation(project) {
  const navigation = document.createElement('nav');
  navigation.className = 'case-navigation';
  navigation.setAttribute('aria-label', '案例切换');
  const publishedProjects = projects.filter((item) => item.status === 'published');
  const index = publishedProjects.findIndex((item) => item.id === project.id);

  const listButton = document.createElement('button');
  listButton.type = 'button';
  listButton.textContent = '返回案例列表';
  listButton.addEventListener('click', () => document.getElementById('featuredProjects').scrollIntoView());
  navigation.append(listButton);

  for (const [label, target] of [['上一案例', publishedProjects[index - 1]], ['下一案例', publishedProjects[index + 1]]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = !target;
    if (target) button.addEventListener('click', () => openCaseReader(target.id));
    navigation.append(button);
  }
  return navigation;
}

function openCaseReader(projectId, focusVideo = false) {
  const project = projects.find((item) => item.id === projectId && item.status === 'published');
  if (!project) return;

  const article = document.createElement('article');
  article.className = 'case-article';
  article.append(
    textElement('p', `${project.year} / ${project.role}`, 'case-meta'),
    textElement('h3', project.title, 'case-title'),
    textElement('p', project.summary, 'case-summary')
  );

  const value = document.createElement('section');
  value.append(textElement('h4', '业务价值'), textElement('p', project.value));
  article.append(value);

  const videoMedia = project.media
    .filter((media) => localMediaPath(media) && mediaKind(media) === 'video')
    .map((media) => describedMedia(media, project, project.media.indexOf(media)));
  for (const media of videoMedia) article.append(createVideo(media, project));

  const challenge = document.createElement('section');
  challenge.append(textElement('h4', '挑战'), textElement('p', project.challenge));
  article.append(challenge);

  const solution = document.createElement('section');
  solution.append(textElement('h4', '解决方案'));
  const steps = document.createElement('ol');
  for (const step of project.solutionSteps) steps.append(textElement('li', step));
  solution.append(steps);
  article.append(solution);

  const imageMedia = project.media
    .filter((media) => localMediaPath(media) && mediaKind(media) === 'image')
    .map((media) => describedMedia(media, project, project.media.indexOf(media)));
  if (imageMedia.length) article.append(createImageGallery(imageMedia, project));

  const delivery = document.createElement('section');
  delivery.append(textElement('h4', '交付说明'), textElement('p', project.delivery));
  article.append(delivery, createNavigation(project));

  caseContent.replaceChildren(article);
  caseReader.hidden = false;
  caseReader.focus();
  if (focusVideo) article.querySelector('.video-start')?.focus();
}

closeImageDialog.addEventListener('click', () => imageDialog.close());
imageDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') imageDialog.close();
});

loadProjects()
  .then((loadedProjects) => {
    projects = loadedProjects;
    renderProjectCards();
  })
  .catch((error) => {
    projectStatus.textContent = error.message;
  });
