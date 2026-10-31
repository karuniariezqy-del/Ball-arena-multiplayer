'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_DIR } = require('./db');

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function sniff(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.slice(0, 4).toString('ascii') === 'GIF8') return 'gif';
  return null;
}

/**
 * Accepts a `data:image/...;base64,...` URI, validates mime + magic bytes and
 * writes it inside the uploads directory with a random filename.
 */
function saveImageDataUrl(dataUrl, { maxBytes = 1.5 * 1024 * 1024, prefix = 'img' } = {}) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('Invalid image data');
  }
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid image encoding');
  const mime = match[1].toLowerCase();
  if (!MIME_EXT[mime]) throw new Error('Only PNG, JPEG, WEBP or GIF images are allowed');
  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    throw new Error('Invalid base64 image');
  }
  if (!buffer.length) throw new Error('Empty image');
  if (buffer.length > maxBytes) throw new Error(`Image too large (max ${Math.round(maxBytes / 1024)}KB)`);
  const ext = sniff(buffer);
  if (!ext || ext !== MIME_EXT[mime]) throw new Error('Image content does not match its type');
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer, { mode: 0o640 });
  return { url: `/uploads/${name}`, bytes: buffer.length };
}

function removeUpload(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  const name = path.basename(url);
  const full = path.join(UPLOAD_DIR, name);
  if (path.dirname(full) !== UPLOAD_DIR) return;
  fs.promises.unlink(full).catch(() => {});
}

module.exports = { saveImageDataUrl, removeUpload, sniff };
