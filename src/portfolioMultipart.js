import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TEMP_DIR = path.join(ROOT, 'public', 'portfolio-media', '.uploads');
const HEADER_LIMIT = 16 * 1024;
const PROJECT_LIMIT = 128 * 1024;

export async function readPortfolioMultipart(request, { maxBytes, temporaryDirectory = DEFAULT_TEMP_DIR }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('The multipart size limit is invalid.');
  const boundary = boundaryFromHeader(request.headers?.['content-type']);
  const parser = new StreamingMultipartParser(boundary, temporaryDirectory);
  let total = 0;
  let sizeError;

  try {
    await mkdir(temporaryDirectory, { recursive: true });
    for await (const value of request) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        sizeError ||= new Error('The multipart upload exceeds the allowed size.');
        continue;
      }
      await parser.push(chunk);
    }
    if (sizeError) throw sizeError;
    return await parser.finish();
  } catch (error) {
    await parser.cleanup();
    throw error;
  }
}

export async function cleanupPortfolioUpload(upload) {
  const paths = Array.isArray(upload?.mediaParts)
    ? upload.mediaParts.map((part) => part?.temporaryPath).filter(Boolean)
    : [];
  await Promise.all(paths.map((temporaryPath) => rm(temporaryPath, { force: true })));
}

class StreamingMultipartParser {
  constructor(boundary, temporaryDirectory) {
    this.initialBoundary = Buffer.from(`--${boundary}`);
    this.nextBoundary = Buffer.from(`\r\n--${boundary}`);
    this.temporaryDirectory = temporaryDirectory;
    this.buffer = Buffer.alloc(0);
    this.state = 'initial';
    this.current = null;
    this.project = undefined;
    this.projectCount = 0;
    this.mediaParts = [];
    this.createdPaths = [];
  }

  async push(chunk) {
    if (this.state === 'done') return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    await this.process(false);
  }

  async finish() {
    await this.process(true);
    if (this.state !== 'done' || this.current || (this.buffer.length && !this.buffer.equals(Buffer.from('\r\n')))) {
      throw new Error('The multipart body is malformed.');
    }
    if (this.projectCount !== 1) throw new Error('The project field must be submitted exactly once.');
    return { project: this.project, mediaParts: this.mediaParts };
  }

  async cleanup() {
    await this.current?.handle?.close().catch(() => {});
    this.current = null;
    await Promise.all(this.createdPaths.map((temporaryPath) => rm(temporaryPath, { force: true })));
  }

  async process(ended) {
    while (true) {
      if (this.state === 'done') return;

      if (this.state === 'initial') {
        if (this.buffer.length < this.initialBoundary.length + 2) {
          if (ended) throw new Error('The multipart body is malformed.');
          return;
        }
        if (!this.buffer.subarray(0, this.initialBoundary.length).equals(this.initialBoundary)
          || !this.buffer.subarray(this.initialBoundary.length, this.initialBoundary.length + 2).equals(Buffer.from('\r\n'))) {
          throw new Error('The multipart body is malformed.');
        }
        this.buffer = this.buffer.subarray(this.initialBoundary.length + 2);
        this.state = 'headers';
        continue;
      }

      if (this.state === 'headers') {
        const headerEnd = this.buffer.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd < 0) {
          if (this.buffer.length > HEADER_LIMIT || ended) throw new Error('The multipart part headers are malformed.');
          return;
        }
        const headers = parseHeaders(this.buffer.subarray(0, headerEnd).toString('latin1'));
        this.buffer = this.buffer.subarray(headerEnd + 4);
        this.current = await this.createPart(headers);
        this.state = 'body';
        continue;
      }

      const boundary = validBoundaryIndex(this.buffer, this.nextBoundary, ended);
      if (boundary.index < 0) {
        const retained = boundary.retained ?? Math.min(this.buffer.length, this.nextBoundary.length + 1);
        const writableLength = this.buffer.length - retained;
        if (writableLength > 0) {
          await this.writePartData(this.buffer.subarray(0, writableLength));
          this.buffer = this.buffer.subarray(writableLength);
        }
        if (ended) throw new Error('The multipart body is malformed.');
        return;
      }

      await this.writePartData(this.buffer.subarray(0, boundary.index));
      await this.finishPart();
      const suffixOffset = boundary.index + this.nextBoundary.length;
      const suffix = this.buffer.subarray(suffixOffset, suffixOffset + 2);
      this.buffer = this.buffer.subarray(suffixOffset + 2);
      if (suffix.equals(Buffer.from('--'))) {
        this.state = 'done';
      } else {
        this.state = 'headers';
      }
    }
  }

  async createPart(headers) {
    const disposition = dispositionParameters(headers.get('content-disposition'));
    const name = disposition.get('name');
    const filename = disposition.get('filename');
    if (!name || (name !== 'project' && name !== 'media')) {
      throw new Error('Only the project field and media file parts are allowed.');
    }
    if (name === 'project') {
      if (filename !== undefined) throw new Error('The project field cannot be a file part.');
      return { name, size: 0, chunks: [] };
    }
    const contentType = headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (!filename || !contentType) throw new Error('Each media part needs a filename and content type.');
    const temporaryPath = path.join(this.temporaryDirectory, `${randomUUID()}.upload`);
    const handle = await open(temporaryPath, 'wx');
    this.createdPaths.push(temporaryPath);
    return { name, originalName: path.basename(filename), mimeType: contentType, temporaryPath, handle, size: 0 };
  }

  async writePartData(data) {
    if (!data.length) return;
    this.current.size += data.length;
    if (this.current.name === 'project') {
      if (this.current.size > PROJECT_LIMIT) throw new Error('The project field is too large.');
      this.current.chunks.push(Buffer.from(data));
      return;
    }
    await this.current.handle.write(data);
  }

  async finishPart() {
    if (this.current.name === 'project') {
      this.projectCount += 1;
      if (this.projectCount > 1) throw new Error('The project field must be submitted exactly once.');
      try {
        this.project = JSON.parse(Buffer.concat(this.current.chunks).toString('utf8'));
      } catch {
        throw new Error('The project field must contain valid JSON.');
      }
    } else {
      await this.current.handle.close();
      this.current.handle = null;
      this.mediaParts.push({
        originalName: this.current.originalName,
        mimeType: this.current.mimeType,
        temporaryPath: this.current.temporaryPath,
        size: this.current.size
      });
    }
    this.current = null;
  }
}

function validBoundaryIndex(buffer, boundary, ended) {
  let offset = 0;
  while (true) {
    const index = buffer.indexOf(boundary, offset);
    if (index < 0) return { index: -1 };
    const suffixOffset = index + boundary.length;
    if (buffer.length < suffixOffset + 2) {
      return ended ? { index: -1 } : { index: -1, retained: buffer.length - index };
    }
    const suffix = buffer.subarray(suffixOffset, suffixOffset + 2);
    if (suffix.equals(Buffer.from('--')) || suffix.equals(Buffer.from('\r\n'))) return { index };
    offset = index + 1;
  }
}

function boundaryFromHeader(contentType = '') {
  const [mediaType] = String(contentType).split(';', 1);
  if (mediaType.trim().toLowerCase() !== 'multipart/form-data') {
    throw new Error('Content-Type must be multipart/form-data.');
  }
  const match = String(contentType).match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] || match?.[2];
  if (!boundary || /[\r\n]/.test(boundary)) throw new Error('The multipart boundary is required.');
  return boundary;
}

function parseHeaders(text) {
  const headers = new Map();
  for (const line of text.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error('The multipart part headers are malformed.');
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!name || !value || headers.has(name)) throw new Error('The multipart part headers are malformed.');
    headers.set(name, value);
  }
  return headers;
}

function dispositionParameters(value = '') {
  const [type, ...parameters] = String(value).split(';');
  if (type.trim().toLowerCase() !== 'form-data') throw new Error('The multipart part disposition is malformed.');
  const parsed = new Map();
  for (const parameter of parameters) {
    const separator = parameter.indexOf('=');
    if (separator <= 0) throw new Error('The multipart part disposition is malformed.');
    const name = parameter.slice(0, separator).trim().toLowerCase();
    let valuePart = parameter.slice(separator + 1).trim();
    if (valuePart.startsWith('"') && valuePart.endsWith('"')) valuePart = valuePart.slice(1, -1);
    if (!name || !valuePart || parsed.has(name)) throw new Error('The multipart part disposition is malformed.');
    parsed.set(name, valuePart);
  }
  return parsed;
}
