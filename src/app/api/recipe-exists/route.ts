import { findRecipeBySourceUrl } from '@/lib/mealie';

interface RequestBody {
  url?: string;
}

export async function POST(req: Request) {
  const body: RequestBody = await req.json();
  const url = body.url?.trim();

  if (!url) {
    return new Response(JSON.stringify({ error: 'Kein URL angegeben.' }), { status: 400 });
  }

  const recipe = await findRecipeBySourceUrl(url);
  return new Response(JSON.stringify({ exists: Boolean(recipe), recipe }), { status: 200 });
}
