import { env } from '@/lib/constants';
import emojiStrip from 'emoji-strip';
import type { recipeInfo, recipeResult } from './types';

export async function postRecipe(recipeData: any) {
    try {
        const payloadData =
            typeof recipeData === 'string'
                ? recipeData
                : JSON.stringify(recipeData);

        const res = await fetch(
            `${env.MEALIE_URL}/api/recipes/create/html-or-json`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${env.MEALIE_API_KEY}`,
                },
                body: JSON.stringify({
                    includeTags: true,
                    data: payloadData,
                }),
                signal: AbortSignal.timeout(120000),
            }
        );

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`${res.status} ${res.statusText} - ${errorText}`);
            throw new Error('Failed to create recipe');
        }
        const body = await res.json();
        console.log('Recipe response:', body);
        return body;
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.error(
                'Timeout creating mealie recipe. Report this issue on Mealie GitHub.'
            );
            throw new Error(
                `Timeout creating mealie recipe. Report this issue on Mealie GitHub. Input URL: ${env.MEALIE_URL}`
            );
        }
        console.error('Error in postRecipe:', error);
        throw new Error(error.message);
    }
}

export async function getRecipe(recipeSlug: string): Promise<recipeResult> {
    const res = await fetch(`${env.MEALIE_URL}/api/recipes/${recipeSlug}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.MEALIE_API_KEY}`,
        },
    });

    const body = await res.json();
    if (!res.ok) throw new Error('Failed to get recipe');

    return {
        name: body.name,
        description: body.description,
        imageUrl: `/api/recipe-image/${body.id}`,
        url: `${env.MEALIE_URL}/g/${env.MEALIE_GROUP_NAME}/r/${recipeSlug}`,
    };
}

function extractRecipeIdentifier(payload: any): string | null {
    if (!payload) return null;

    const candidates = [
        payload.slug,
        payload.recipeSlug,
        payload.recipe_slug,
        payload.id,
        payload.recipeId,
        payload.recipe_id,
        payload?.recipe?.slug,
        payload?.recipe?.id,
    ];

    const found = candidates.find((value) => typeof value === 'string' || typeof value === 'number');
    return found ? String(found) : null;
}

export async function postRecipeImage(image: Blob, filename: string, tags: string[]) {
    try {
        const formData = new FormData();
        formData.append('image', image, filename);

        if (tags.length > 0) {
            formData.append('tags', JSON.stringify(tags));
        }

        const res = await fetch(`${env.MEALIE_URL}/api/recipes/create/image`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.MEALIE_API_KEY}`,
            },
            body: formData,
            signal: AbortSignal.timeout(120000),
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`${res.status} ${res.statusText} - ${errorText}`);
            throw new Error('Failed to create recipe from image');
        }

        const body = await res.json();
        const recipeIdentifier = extractRecipeIdentifier(body);

        if (!recipeIdentifier) {
            throw new Error('Unexpected response from Mealie image import.');
        }

        return recipeIdentifier;
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.error(
                'Timeout creating mealie recipe from image. Report this issue on Mealie GitHub.'
            );
            throw new Error(
                `Timeout creating mealie recipe from image. Report this issue on Mealie GitHub. Input URL: ${env.MEALIE_URL}`
            );
        }
        console.error('Error in postRecipeImage:', error);
        throw new Error(error.message);
    }
}

function normalizeRecipeList(payload: any): any[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
}

function extractSourceUrl(candidate: any): string | null {
    if (!candidate) return null;
    const options = [
        candidate.sourceUrl,
        candidate.source_url,
        candidate.url,
        candidate.originalUrl,
        candidate.original_url,
    ];
    const found = options.find((value) => typeof value === 'string' && value.length > 0);
    return found ? String(found) : null;
}

function extractRecipeSlug(candidate: any): string | null {
    if (!candidate) return null;
    const options = [
        candidate.slug,
        candidate.recipeSlug,
        candidate.recipe_slug,
        candidate.id,
        candidate.recipeId,
        candidate.recipe_id,
    ];
    const found = options.find((value) => typeof value === 'string' || typeof value === 'number');
    return found ? String(found) : null;
}

function normalizeSourceUrl(sourceUrl: string): string {
    // Normalize URLs to avoid duplicates caused by tracking params, casing, or trailing slashes.
    try {
        const parsed = new URL(sourceUrl.trim());
        const hostname = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
        const trimmedPath = parsed.pathname.replace(/\/+$/, '');
        const normalizedPath = trimmedPath === '' ? '' : trimmedPath;
        return `${parsed.protocol}//${hostname}${normalizedPath}`;
    } catch {
        return sourceUrl.trim().toLowerCase().replace(/\/+$/, '');
    }
}

async function fetchRecipeSearchResults(query: string) {
    const encoded = encodeURIComponent(query);
    const endpoints = [
        `${env.MEALIE_URL}/api/recipes?search=${encoded}`,
        `${env.MEALIE_URL}/api/recipes?query=${encoded}`,
    ];

    for (const endpoint of endpoints) {
        const res = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.MEALIE_API_KEY}`,
            },
        });

        if (res.ok) {
            return res.json();
        }
    }

    return null;
}

export async function findRecipeIdentifierBySourceUrl(sourceUrl: string): Promise<string | null> {
    // Query with normalized URLs first so search + comparison remain consistent across variants.
    const normalizedSource = normalizeSourceUrl(sourceUrl);
    const searchQueries = Array.from(new Set([normalizedSource, sourceUrl.trim()]));

    for (const query of searchQueries) {
        const payload = await fetchRecipeSearchResults(query);
        const items = normalizeRecipeList(payload);

        const match = items.find((item) => {
            const candidateUrl = extractSourceUrl(item);
            if (!candidateUrl) return false;
            const normalizedCandidate = normalizeSourceUrl(candidateUrl);
            return normalizedCandidate === normalizedSource;
        });

        if (match) return extractRecipeSlug(match);
    }

    return null;
}

export async function findRecipeBySourceUrl(sourceUrl: string): Promise<recipeResult | null> {
    const identifier = await findRecipeIdentifierBySourceUrl(sourceUrl);
    if (!identifier) return null;

    try {
        return await getRecipe(identifier);
    } catch {
        return null;
    }
}
