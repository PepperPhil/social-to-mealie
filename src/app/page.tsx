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

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-3xl font-bold">Welcome to social to Mealie</h1>

      {/* PWA Share-Import Runner: liest ?url=...&autostart=1 intern via AutoImport */}
      <ShareImportRunner tags={tags} />

      {/* Manuelles Einfügen bleibt */}
      <RecipeFetcher tags={tags} />

      <div className="w-fit min-w-96 m-4">
        <GetTagSelect query={tagQuery} />
      </div>
    </div>
  );
}
