// Varden — card art upload.
//
// This has to be a Node.js function, not an Edge one: @vercel/blob pulls in
// node:stream and undici, and the edge bundler rejects those modules (the whole
// deployment fails with "referencing unsupported modules"). vercel.json already
// builds api/** with @vercel/node, so the route only has to behave like one.
//
// The browser posts the raw image bytes with the account and slug in headers,
// which avoids carrying a multipart parser here; `bodyParser` is off so the bytes
// arrive as they were sent.
//
// Without BLOB_READ_WRITE_TOKEN there is nowhere to put the file. That is answered
// as 503 with a sentence the page can act on (it keeps the picture inline), rather
// than a 500 the browser console cannot explain.
import { put } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 6 * 1024 * 1024;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function header(req, name) {
  const raw = req.headers?.[name];
  if (!raw) return '';
  try {
    return decodeURIComponent(String(raw));
  } catch {
    return String(raw);
  }
}

async function readBytes(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Object.assign(new Error('too large'), { tooLarge: true });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const type = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  const extension = EXTENSIONS[type];
  if (!extension) return send(res, 415, { error: 'Send the image itself as PNG, JPEG, WebP or GIF.' });

  const userId = header(req, 'x-varden-user').trim();
  const slug = header(req, 'x-varden-slug').trim();
  if (!userId) return send(res, 400, { error: 'Missing the signed-in account for this picture.' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return send(res, 503, { error: 'Art storage is not configured on this deployment.' });
  }

  let bytes;
  try {
    bytes = await readBytes(req);
  } catch (error) {
    if (error?.tooLarge) return send(res, 413, { error: 'That picture is larger than 6 MB.' });
    console.error('Varden: reading the upload failed', error);
    return send(res, 400, { error: 'The picture could not be read.' });
  }
  if (!bytes?.length) return send(res, 400, { error: 'The picture was empty.' });

  const safeUser = userId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) || 'anon';
  const safeSlug = slug.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 48) || 'card';

  try {
    const blob = await put(`characters/${safeUser}/${safeSlug}-${Date.now()}.${extension}`, bytes, {
      access: 'public',
      contentType: type,
      addRandomSuffix: false,
    });
    return send(res, 200, { url: blob.url, path: blob.pathname });
  } catch (error) {
    console.error('Varden: blob upload failed', error);
    return send(res, 502, { error: 'The image store refused the upload.' });
  }
}
