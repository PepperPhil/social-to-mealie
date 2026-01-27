import { RecipeFetcher } from '@/components/recipe-fetcher';
import GetTagSelect from '../components/tag-select/tag-fetch';
import ShareImportRunner from '@/components/share-import-runner';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;

  const tagQuery = sp.tagQuery as string | undefined;
  const tags = (sp.tags as string)?.split(',').filter(Boolean) ?? [];

  // Share-Target Params (/share redirectet auf /?url=...&autostart=1)
  const sharedUrl = sp.url as string | undefined;
  const autostart = sp.autostart === '1';

  return (
    <div className='flex flex-col items-center justify-center h-screen'>
      <h1 className='text-3xl font-bold'>Welcome to social to Mealie</h1>

      {/* startet automatisch, wenn autostart=1 */}
      <ShareImportRunner tags={tags} sharedUrl={sharedUrl} autostart={autostart} />

      {/* zeigt die URL im Textfeld an */}
      <RecipeFetcher tags={tags} sharedUrl={sharedUrl} />

      <div className='w-fit min-w-96 m-4'>
        <GetTagSelect query={tagQuery} />
      </div>
    </div>
  );
}
