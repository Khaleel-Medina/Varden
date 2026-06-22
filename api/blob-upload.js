import { put } from '@vercel/blob';

export const runtime = 'edge';

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get('file');
  const userId = formData.get('userId');
  const slug = formData.get('slug');

  if (!file || !userId) {
    return new Response(JSON.stringify({ error: 'Missing file or userId' }), { status: 400 });
  }

  const ext = file.name.split('.').pop() || 'png';
  const blob = await put(`characters/${userId}/${slug}-${Date.now()}.${ext}`, file, {
    access: 'public',
    contentType: file.type,
  });

  return new Response(JSON.stringify({ url: blob.url, path: blob.path }));
}
