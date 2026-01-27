import { NextResponse } from 'next/server';

function extractFirstUrl(input: string): string | null {
  const m = input.match(/https?:\/\/\S+/i);
  return m ? m[0].replace(/[)\],.]*$/, '') : null;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const title = String(form.get('title') ?? '');
  const text = String(form.get('text') ?? '');
  const url = String(form.get('url') ?? '');

  const candidate = [url, text, title].filter(Boolean).join('\n');
  const sharedUrl = extractFirstUrl(candidate);

  if (!sharedUrl) {
    return NextResponse.redirect(new URL('/?error=no_url', req.url), 303);
  }

  // Wir leiten auf die Startseite weiter und geben URL + autostart mit.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  
  if (!host) {
    return NextResponse.redirect(new URL('/?error=no_host', req.url), 303);
  }
  
  const base = `${proto}://${host}`;
  const u = new URL('/', base);
  
  u.searchParams.set('url', sharedUrl);
  u.searchParams.set('autostart', '1');
  
  return NextResponse.redirect(u, 303);
  
  // const u = new URL('/', req.url);
  // u.searchParams.set('url', sharedUrl);
  // u.searchParams.set('autostart', '1');
  // return NextResponse.redirect(u, 303);
}

export async function GET(req: Request) {
  // Fallback: falls irgendwer /share per GET aufruft
  return NextResponse.redirect(new URL('/', req.url), 303);
}
