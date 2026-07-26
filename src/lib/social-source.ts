// Shared helpers for deriving Mealie tags/filenames from a source URL.
// Used by both the video/URL import pipeline and the image import pipeline.

const hostAliases: Record<string, string> = {
    'youtu.be': 'youtube',
};

export function getSourceTag(url: string): string | null {
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        const normalizedHost = hostname.replace(/^m\./, '');
        const alias = hostAliases[normalizedHost];
        const hostParts = (alias ?? normalizedHost).split('.').filter(Boolean);
        const base = hostParts.length >= 2 ? hostParts[hostParts.length - 2] : hostParts[0];

        if (!base) return null;

        const formatted = base.charAt(0).toUpperCase() + base.slice(1);
        return `#${formatted}`;
    } catch {
        return null;
    }
}

export function addSourceTag(url: string, tags: string[]): string[] {
    const sourceTag = getSourceTag(url);
    if (!sourceTag) return tags;

    const normalized = new Set(tags.map((tag) => tag.trim().toLowerCase()));
    if (normalized.has(sourceTag.toLowerCase())) return tags;

    return [...tags, sourceTag];
}

export function filenameFromUrl(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const name = pathname.split('/').pop();
        return name && name.trim().length > 0 ? name : 'upload.jpg';
    } catch {
        return 'upload.jpg';
    }
}
