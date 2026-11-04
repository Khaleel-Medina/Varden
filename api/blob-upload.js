// Varden — card art upload.
//
// Vercel only treats this as an Edge Function with `config.runtime` plus a default
// export; the earlier Next-style `runtime` + named POST export made the route fall
// through to a 404, so every Studio upload failed to reach Blob.
//
// Without BLOB_READ_WRITE_TOKEN there is nowhere to put the file. That is answered
// as 503 with a sentence the page can act on (it keeps the picture inline), rather
// than a 500 the browser console cannot explain.
import { put } from '@vercel/blob';

export const config = { runtime: 'edge' };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Expected a multipart form with a file.' }, 400);
  }

  const file = form.get('file');
  const userId = form.get('userId');
  const slug = form.get('slug');
  if (!file || typeof file === 'string' || !userId) return json({ error: 'Missing file or userId' }, 400);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json({ error: 'Art storage is not configured on this deployment.' }, 503);
  }

  const extension = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const safeUser = String(userId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) || 'anon';
  const safeSlug = String(slug || 'card').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 48) || 'card';

  try {
    const blob = await put(`characters/${safeUser}/${safeSlug}-${Date.now()}.${extension}`, file, {
      access: 'public',
      contentType: file.type || 'image/png',
    });
    return json({ url: blob.url, path: blob.pathname });
  } catch (error) {
    console.error('Varden: blob upload failed', error);
    return json({ error: 'The image store refused the upload.' }, 502);
  }
}
