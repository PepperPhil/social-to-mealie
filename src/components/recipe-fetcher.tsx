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

function extractFirstUrl(input: string): string | null {
  const m = input.match(/https?:\/\/\S+/i);
  return m ? m[0].replace(/[)\],.]*$/, '') : null;
}

export function RecipeFetcher({ tags }: { tags: string[] }) {
  const sp = useSearchParams();
  const placeholderImage = '/recipe-placeholder.svg';

  const [urlInput, setUrlInput] = useState('');
  const [progress, setProgress] = useState<progressType | null>(null);
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recipes, setRecipe] = useState<recipeResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  // ✅ Share-URL automatisch ins Textfeld übernehmen (nur wenn Feld leer ist)
  useEffect(() => {
    if (urlInput.trim().length > 0) return;

    const url = sp.get('url') ?? '';
    const text = sp.get('text') ?? '';
    const title = sp.get('title') ?? '';
    const candidate = [url, text, title].filter(Boolean).join('\n');
    const sharedUrl = extractFirstUrl(candidate);

    if (sharedUrl) setUrlInput(sharedUrl);
  }, [sp, urlInput]);

  async function fetchRecipe() {
    setLoading(true);
    setProgress(null);
    setLogs([]);
    setError(null);

    const urlList: string[] = urlInput
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);

    try {
      for (const url of urlList) {
        const response = await fetch('/api/get-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/event-stream',
          },
          body: JSON.stringify({ url, tags }),
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
                setTimeout(() => setProgress(null), 10000);
              } else if (data.error) {
                setError(data.error);
                setLoading(false);
              }
            } catch {
              setError('Error parsing event stream');
              setLoading(false);
            }
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
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

      {progress && (
        <Card className={'mt-4 w-96'}>
          <CardHeader>
            <CardTitle>{error || 'Progress'}</CardTitle>
          </CardHeader>
          <CardContent className={'flex flex-col gap-4 justify-center items-center'}>
            <div className={'flex flex-col gap-1 text-sm'}>
              <div className={'flex items-center gap-4'}>
                <span>Video downloaded</span>
                {progress.videoDownloaded === true ? (
                  <CircleCheck />
                ) : progress.videoDownloaded === null ? (
                  <Spinner size={'small'} />
                ) : (
                  <CircleX />
                )}
              </div>
              {latestLogByStep.video?.message ? (
                <span className="text-xs opacity-70">{latestLogByStep.video.message}</span>
              ) : null}
            </div>
            <div className={'flex flex-col gap-1 text-sm'}>
              <div className={'flex items-center gap-4'}>
                <span>Audio transcribed</span>
                {progress.audioTranscribed === true ? (
                  <CircleCheck />
                ) : progress.audioTranscribed === null ? (
                  <Spinner size={'small'} />
                ) : (
                  <CircleX />
                )}
              </div>
              {latestLogByStep.audio?.message ? (
                <span className="text-xs opacity-70">{latestLogByStep.audio.message}</span>
              ) : null}
            </div>
            <div className={'flex flex-col gap-1 text-sm'}>
              <div className={'flex items-center gap-4'}>
                <span>Recipe created</span>
                {progress.recipeCreated === true ? (
                  <CircleCheck />
                ) : progress.recipeCreated === null ? (
                  <Spinner size={'small'} />
                ) : (
                  <CircleX />
                )}
              </div>
              {latestLogByStep.recipe?.message ? (
                <span className="text-xs opacity-70">{latestLogByStep.recipe.message}</span>
              ) : null}
            </div>
          </CardContent>
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
