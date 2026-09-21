import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const extensions: Record<string, readonly string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/svg+xml': ['.svg'],
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/x-wav': ['.wav'],
  'audio/ogg': ['.ogg', '.oga'],
  'audio/mp4': ['.m4a'],
  'audio/x-m4a': ['.m4a'],
  'audio/aac': ['.aac'],
  'audio/webm': ['.weba', '.webm'],
};

export const AUDIO_MAX_BYTES = 50_000_000;

export type AssetKind = 'image' | 'audio';

/** Images are placed or read by the model; audio is only ever described to it. */
export function assetKind(contentType: string): AssetKind {
  return contentType.startsWith('audio/') ? 'audio' : 'image';
}

export function validateAssetMetadata(fileName: string, contentType: string, byteSize: number) {
  const allowed = extensions[contentType];
  if (!allowed || !allowed.includes(path.extname(fileName).toLowerCase())) {
    throw new Error('Asset filename extension does not match its content type.');
  }
  if (assetKind(contentType) === 'audio') {
    if (byteSize > AUDIO_MAX_BYTES) throw new Error('Audio assets are limited to 50 MB.');
    return;
  }
  if (contentType === 'image/svg+xml' && byteSize > 2_000_000) throw new Error('SVG assets are limited to 2 MB.');
  if (contentType !== 'image/svg+xml' && byteSize > 20_000_000) throw new Error('Raster image assets are limited to 20 MB.');
}

export async function validateStoredAsset(filePath: string, contentType: string) {
  if (contentType === 'image/svg+xml') {
    const metadata = await stat(filePath);
    if (metadata.size > 2_000_000) throw new Error('SVG assets are limited to 2 MB.');
    const svg = await readFile(filePath, 'utf8');
    if (!/<svg\b/i.test(svg) || containsUnsafeSvg(svg)) {
      throw new Error('SVG asset contains unsupported active or remote content.');
    }
    return;
  }

  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    if (!matchesSignature(contentType, header)) throw new Error('Asset bytes do not match the declared content type.');
  } finally {
    await handle.close();
  }
}

export function validateAssetBuffer(content: Buffer, contentType: string) {
  if (contentType === 'image/svg+xml') {
    if (content.byteLength > 2_000_000) throw new Error('SVG assets are limited to 2 MB.');
    validateSvgContent(content.toString('utf8'));
    return;
  }
  if (!matchesSignature(contentType, content.subarray(0, 16))) {
    throw new Error('Asset bytes do not match the declared content type.');
  }
}

export function validateSvgContent(svg: string) {
  if (!/<svg\b/i.test(svg) || containsUnsafeSvg(svg)) {
    throw new Error('SVG asset contains unsupported active or remote content.');
  }
}

function containsUnsafeSvg(svg: string) {
  return /<\s*(?:script|iframe|object|embed|foreignObject)\b/i.test(svg)
    || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svg)
    || /\bon[a-z]+\s*=/i.test(svg)
    || /\b(?:href|src)\s*=\s*["']\s*(?!#)[^"']*["']/i.test(svg)
    || /@import\b/i.test(svg)
    || /url\(\s*["']?\s*(?!#)[^)]+\)/i.test(svg)
    || /(?:javascript:|expression\s*\(|-moz-binding\s*:|behavior\s*:)/i.test(svg);
}

function matchesSignature(contentType: string, header: Buffer) {
  const ascii = header.toString('ascii');
  const hex = header.toString('hex');
  switch (contentType) {
    case 'image/png': return hex.startsWith('89504e470d0a1a0a');
    case 'image/jpeg': return hex.startsWith('ffd8ff');
    case 'image/gif': return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
    case 'image/webp': return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    case 'video/mp4':
    case 'video/quicktime': return ascii.slice(4, 8) === 'ftyp';
    case 'video/webm': return hex.startsWith('1a45dfa3');
    case 'audio/mpeg': return ascii.startsWith('ID3') || (header[0] === 0xff && (header[1]! & 0xe0) === 0xe0);
    case 'audio/wav':
    case 'audio/x-wav': return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
    case 'audio/ogg': return ascii.startsWith('OggS');
    case 'audio/mp4':
    case 'audio/x-m4a': return ascii.slice(4, 8) === 'ftyp';
    case 'audio/aac': return header[0] === 0xff && (header[1]! & 0xf6) === 0xf0;
    case 'audio/webm': return hex.startsWith('1a45dfa3');
    case 'font/woff': return ascii.startsWith('wOFF');
    case 'font/woff2': return ascii.startsWith('wOF2');
    case 'font/ttf': return hex.startsWith('00010000') || ascii.startsWith('true');
    case 'font/otf': return ascii.startsWith('OTTO');
    default: return false;
  }
}
