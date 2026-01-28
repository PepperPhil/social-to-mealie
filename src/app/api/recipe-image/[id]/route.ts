import { env } from '@/lib/constants';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const imageUrl = `${env.MEALIE_URL}/api/media/recipes/${params.id}/images/original.webp`;

  const response = await fetch(imageUrl, {
    headers: {
      Authorization: `Bearer ${env.MEALIE_API_KEY}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return new Response('Image not available', { status: response.status });
  }

  const contentType = response.headers.get('content-type') ?? 'image/webp';
  const buffer = await response.arrayBuffer();

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
    },
  });
}
