'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import type { progressType, recipeResult } from '@/lib/types';
import { CircleCheck, CircleX } from 'lucide-react';

type StepKey = 'video' | 'audio' | 'recipe';

type StepLog = {
  step: StepKey;
  ok: boolean | null;
  message: string;
  ts: number;
};

function isLikelyImageUrl(input: string) {
  return /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|avif)(\?.*)?$/i.test(input);
}

function extractFirstUrl(input: string): string | null {
  const m = input.match(/https?:\/\/\S+/i);
  return m ? m[0].replace(/[)\],.]*$/, '') : null;
}

export function RecipeFetcher({ tags }: { tags: string[] }) {
  const sp = useSearchParams();
  const placeholderImage = '/recipe-placeholder.svg';

  const [urlInput, setUrlInput] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<progressType | null>(null);
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recipes, setRecipe] = useState<recipeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [importMode, setImportMode] = useState<'url' | 'image'>('url');

  const isImageImport = importMode === 'image';

  // ✅ Share-URL automatisch ins Textfeld übernehmen (nur wenn Feld leer ist)
  useEffect(() => {
    if (urlInput.trim().length > 0 || imageUrlInput.trim().length > 0) return;

    const url = sp.get('url') ?? '';
    const text = sp.get('text') ?? '';
    const title = sp.get('title') ?? '';
    const candidate = [url, text, title].filter(Boolean).join('\n');
    const sharedUrl = extractFirstUrl(candidate);

    if (sharedUrl) {
      if (isLikelyImageUrl(sharedUrl)) {
        setImageUrlInput(sharedUrl);
      } else {
        setUrlInput(sharedUrl);
      }
    }
  }, [sp, urlInput, imageUrlInput]);

  async function confirmReimportIfExists(url: string) {
    try {
      const response = await fetch('/api/recipe-exists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (!response.ok || !data?.exists) return { shouldImport: true, force: false };

      const recipeName = data?.recipe?.name ? ` "${data.recipe.name}"` : '';
      const confirmed = window.confirm(`Das Rezept${recipeName} existiert bereits. Erneut importieren?`);
      return { shouldImport: confirmed, force: confirmed };
    } catch {
      return { shouldImport: true, force: false };
    }
  }

  async function fetchRecipe() {
    setLoading(true);
    setProgress(null);
    setLogs([]);
    setError(null);
    setIsCollapsed(false);
    setImportMode('url');

    const urlList: string[] = urlInput
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);

    try {
      for (const url of urlList) {
        const { shouldImport, force } = await confirmReimportIfExists(url);
        if (!shouldImport) {
          continue;
        }

        const response = await fetch('/api/get-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/event-stream',
          },
          body: JSON.stringify({ url, tags, force }),
        });

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) throw new Error('No readable stream available');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          chunk.split('\n\n').forEach((event) => {
            if (!event.startsWith('data: ')) return;

            try {
              const data = JSON.parse(event.replace('data: ', ''));

              if (data.progress) {
                setProgress(data.progress);
              }

              if (data.logs) {
                setLogs(data.logs);
              }

              if (data.name) {
                setRecipe((recipes) => [...(recipes || []), data]);
                setLoading(false);
                setIsCollapsed(true);
              } else if (data.error) {
                setError(data.error);
                setLoading(false);
                setIsCollapsed(false);
              }
            } catch {
              setError('Error parsing event stream');
              setLoading(false);
              setIsCollapsed(false);
            }
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsCollapsed(false);
    } finally {
      setLoading(false);
    }
  }

  async function fetchImageRecipe() {
    if (!imageFile && imageUrlInput.trim().length === 0) return;

    setLoading(true);
    setProgress({
      videoDownloaded: null,
      audioTranscribed: null,
      recipeCreated: null,
    });
    setLogs([]);
    setError(null);
    setIsCollapsed(false);
    setImportMode('image');

    try {
      let response: Response;

      if (imageFile) {
        const data = new FormData();
        data.append('image', imageFile);
        data.append('tags', JSON.stringify(tags));
        data.append('force', 'false');

        response = await fetch('/api/get-image', {
          method: 'POST',
          body: data,
        });
      } else {
        const { shouldImport, force } = await confirmReimportIfExists(imageUrlInput.trim());
        if (!shouldImport) {
          setLoading(false);
          return;
        }

        response = await fetch('/api/get-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ imageUrl: imageUrlInput.trim(), tags, force }),
        });
      }

      const data = await response.json().catch(() => ({} as any));

      if (data.progress) {
        setProgress(data.progress);
      }

      if (data.logs) {
        setLogs(data.logs);
      }

      if (!response.ok) {
        setError(data?.error ?? `Import fehlgeschlagen (HTTP ${response.status})`);
        setLoading(false);
        setIsCollapsed(false);
        return;
      }

      if (data.name) {
        setRecipe((recipes) => [...(recipes || []), data]);
      }

      setLoading(false);
      setIsCollapsed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
      setIsCollapsed(false);
    }
  }

  const latestLogByStep = useMemo(() => {
    const map: Record<StepKey, StepLog | undefined> = {
      video: undefined,
      audio: undefined,
      recipe: undefined,
    };
    logs.forEach((entry) => {
      map[entry.step] = entry;
    });
    return map;
  }, [logs]);

  return (
    <>
      <Textarea
        placeholder={'Insert all the urls to import separated by ,'}
        className='w-96 m-4'
        value={urlInput}
        onChange={(e) => setUrlInput(e.target.value)}
      />

      <Button className='w-96' onClick={fetchRecipe} disabled={loading}>
        {loading ? 'Loading...' : 'Submit'}
      </Button>

      <div className="mt-4 w-96 space-y-2">
        <div className="text-sm font-medium">Image import</div>
        <input
          type="url"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
          placeholder="Paste image URL"
          value={imageUrlInput}
          onChange={(e) => {
            setImageUrlInput(e.target.value);
            if (e.target.value.trim().length > 0) setImageFile(null);
          }}
        />
        <input
          type="file"
          accept="image/*"
          className="w-full text-sm"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setImageFile(file);
            if (file) setImageUrlInput('');
          }}
        />
        <Button
          className="w-full"
          variant="secondary"
          onClick={fetchImageRecipe}
          disabled={loading || (!imageFile && imageUrlInput.trim().length === 0)}
        >
          {loading ? 'Loading...' : 'Import image'}
        </Button>
      </div>

      {progress && (
        <Card className={'mt-4 w-96'}>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>{error || 'Progress'}</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setIsCollapsed((current) => !current)}
            >
              {isCollapsed ? 'Show' : 'Hide'}
            </Button>
          </CardHeader>
          {!isCollapsed && (
            <CardContent className={'flex w-full flex-col gap-4'}>
              <div className={'flex flex-col gap-1 text-sm'}>
                <div className={'flex items-center justify-between gap-4'}>
                  <span>{isImageImport ? 'Image uploaded' : 'Video downloaded'}</span>
                  {progress.videoDownloaded === true ? (
                    <CircleCheck className="text-green-500" />
                  ) : progress.videoDownloaded === null ? (
                    <Spinner size={'small'} />
                  ) : (
                    <CircleX className="text-red-500" />
                  )}
                </div>
                {latestLogByStep.video?.message ? (
                  <span className="text-xs opacity-70">{latestLogByStep.video.message}</span>
                ) : null}
              </div>
              <div className={'flex flex-col gap-1 text-sm'}>
                <div className={'flex items-center justify-between gap-4'}>
                  <span>{isImageImport ? 'Text extracted' : 'Audio transcribed'}</span>
                  {progress.audioTranscribed === true ? (
                    <CircleCheck className="text-green-500" />
                  ) : progress.audioTranscribed === null ? (
                    <Spinner size={'small'} />
                  ) : (
                    <CircleX className="text-red-500" />
                  )}
                </div>
                {latestLogByStep.audio?.message ? (
                  <span className="text-xs opacity-70">{latestLogByStep.audio.message}</span>
                ) : null}
              </div>
              <div className={'flex flex-col gap-1 text-sm'}>
                <div className={'flex items-center justify-between gap-4'}>
                  <span>Recipe created</span>
                  {progress.recipeCreated === true ? (
                    <CircleCheck className="text-green-500" />
                  ) : progress.recipeCreated === null ? (
                    <Spinner size={'small'} />
                  ) : (
                    <CircleX className="text-red-500" />
                  )}
                </div>
                {latestLogByStep.recipe?.message ? (
                  <span className="text-xs opacity-70">{latestLogByStep.recipe.message}</span>
                ) : null}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {recipes && (
        <div className='flex flex-wrap justify-center gap-4 max-w-7xl'>
          {recipes.map((recipe) => (
            <a href={recipe.url} key={recipe.url} target='_blank' rel='noreferrer'>
              <Card className='mt-4 w-60'>
                <CardHeader>
                  <img
                    src={recipe.imageUrl}
                    alt={recipe.description}
                    className='aspect-square object-cover'
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = placeholderImage;
                    }}
                  />
                  <CardTitle>{recipe.name}</CardTitle>
                  <CardDescription>{recipe.description}</CardDescription>
                </CardHeader>
              </Card>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
