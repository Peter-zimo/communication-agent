import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CUSTOMERS_DIR = path.join(ROOT, 'data', 'customers');

/* ─── Frontmatter 解析 ─── */

export function parseCustomerMarkdown(text) {
  const src = String(text || '');
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: src };

  const yamlBlock = match[1];
  const body = src.slice(match[0].length).trimStart();

  const frontmatter = {};
  for (const line of yamlBlock.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/* ─── Markdown 生成 ─── */

export function buildCustomerMarkdown({ frontmatter = {}, body = '' } = {}) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(body);
  return lines.join('\n');
}

/* ─── 文件名工具 ─── */

function sanitizeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*]/g, '_').trim();
}

function buildFileName(customerName, meetingType, date) {
  const safe = sanitizeFileName(customerName);
  const type = String(meetingType || '').toUpperCase();
  const dateStr = date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${safe}-${type}-${dateStr}.md`;
}

function extractCustomerName(fileName) {
  // 文件名格式: {客户名}-{类型}-{日期}.md
  // 类型是 A/B/C，日期是 8 位数字
  const match = String(fileName).match(/^(.+)-[ABC]-(\d{8})\.md$/);
  return match ? match[1] : null;
}

/* ─── 客户列表 ─── */

export async function listCustomers() {
  await mkdir(CUSTOMERS_DIR, { recursive: true });
  const files = await readdir(CUSTOMERS_DIR);
  const mdFiles = files.filter((f) => f.endsWith('.md'));

  // 按客户名分组，每组只保留最新文件
  const customerLatest = new Map();
  const fileDetails = [];

  for (const file of mdFiles) {
    const name = extractCustomerName(file);
    if (!name) continue;
    const filePath = path.join(CUSTOMERS_DIR, file);
    const stat = await import('node:fs/promises').then((m) => m.stat(filePath));
    fileDetails.push({ name, file, updatedAt: stat.mtime.toISOString(), mtime: stat.mtime });
  }

  // 按修改时间倒序
  fileDetails.sort((a, b) => b.mtime - a.mtime);

  // 同一客户只保留最新的
  for (const detail of fileDetails) {
    if (!customerLatest.has(detail.name)) {
      customerLatest.set(detail.name, {
        name: detail.name,
        file: detail.file,
        updatedAt: detail.updatedAt
      });
    }
  }

  return Array.from(customerLatest.values());
}

/* ─── 读取客户历史 ─── */

export async function readCustomerHistory(customerName) {
  if (!customerName) return null;
  await mkdir(CUSTOMERS_DIR, { recursive: true });
  const files = await readdir(CUSTOMERS_DIR);
  const safe = sanitizeFileName(customerName);

  // 查找匹配的文件：以 "{客户名}-" 开头的 .md 文件
  const matches = files
    .filter((f) => f.endsWith('.md') && f.startsWith(safe + '-'))
    .sort()
    .reverse(); // 按文件名倒序，最新日期排前面

  if (matches.length === 0) return null;

  const content = await readFile(path.join(CUSTOMERS_DIR, matches[0]), 'utf8');
  return parseCustomerMarkdown(content);
}

/* ─── 保存客户历史 ─── */

export async function saveCustomerHistory(customerName, data) {
  if (!customerName) throw new Error('客户名不能为空');
  await mkdir(CUSTOMERS_DIR, { recursive: true });

  const frontmatter = { ...data.frontmatter, '客户': customerName };
  const md = buildCustomerMarkdown({ frontmatter, body: data.body || '' });

  // 查找已有文件：同客户同会议类型则覆盖
  const meetingType = frontmatter['会议类型'] || '';
  const files = await readdir(CUSTOMERS_DIR);
  const safe = sanitizeFileName(customerName);
  const typePattern = meetingType ? `-${String(meetingType).toUpperCase()}-` : '-';

  const existing = files.find((f) =>
    f.endsWith('.md') && f.startsWith(safe + '-') && f.includes(typePattern)
  );

  const fileName = existing || buildFileName(customerName, meetingType);
  await writeFile(path.join(CUSTOMERS_DIR, fileName), md, 'utf8');
}

/* ─── 从 workspace 自动保存客户档案 ─── */

export function workspaceToFrontmatter(workspace, customerName) {
  const fields = new Map(
    (workspace?.fields || []).map((f) => [f.id, f])
  );
  return {
    '客户': customerName,
    '行业': '',
    '会议类型': workspace?.meetingType || '',
    '阶段': workspace?.meetingTypeLabel || '',
    '决策人': fields.get('executive_contact')?.value || '',
    '上次交流': new Date().toISOString().slice(0, 10)
  };
}

export function workspaceToBody(workspace) {
  const fields = new Map(
    (workspace?.fields || []).map((f) => [f.id, f])
  );
  const lines = [];

  // 会后总结
  const conclusion = fields.get('meeting_conclusion');
  if (conclusion?.value) {
    lines.push('## 会后总结', `- ${conclusion.value}`);
  }

  // 已确认信息
  const confirmedIds = ['customer_needs', 'decisions', 'confirmed_constraints'];
  const confirmedLabels = { customer_needs: '客户需求与关注点', decisions: '客户已确认的决定', confirmed_constraints: '已确认的范围与约束' };
  const confirmedEntries = confirmedIds
    .map((id) => ({ id, field: fields.get(id) }))
    .filter(({ field }) => field?.value);
  if (confirmedEntries.length) {
    lines.push('', '## 已确认信息');
    for (const { id, field } of confirmedEntries) {
      lines.push(`- **${confirmedLabels[id] || id}**：${field.value}`);
    }
  }

  // 行动项
  const actions = [
    { id: 'internal_actions', label: '我方行动项' },
    { id: 'customer_actions', label: '客户侧行动项' },
    { id: 'next_step', label: '下一步' }
  ];
  const actionEntries = actions
    .map((a) => ({ ...a, field: fields.get(a.id) }))
    .filter(({ field }) => field?.value);
  if (actionEntries.length) {
    lines.push('', '## 行动项');
    for (const { label, field } of actionEntries) {
      lines.push(`- **${label}**：${field.value}`);
    }
  }

  // 风险
  const risks = fields.get('risks');
  if (risks?.value) {
    lines.push('', '## 风险与待确认', `- ${risks.value}`);
  }

  return lines.join('\n');
}

export async function saveFromWorkspace(workspace, customerName) {
  if (!customerName || !workspace) return;
  const frontmatter = workspaceToFrontmatter(workspace, customerName);
  const body = workspaceToBody(workspace);
  return saveCustomerHistory(customerName, { frontmatter, body });
}
