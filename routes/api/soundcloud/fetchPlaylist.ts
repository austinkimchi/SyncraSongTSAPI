import { API_router, db, getUserId } from '../api.js';
import type { UserDoc } from '../../../types/database.js';
import type { Playlist } from '../../auth/playlist.js';

const SOUNDCLOUD_API_BASE = 'https://api.soundcloud.com';
const DEFAULT_PAGE_LIMIT = 200;

interface SoundCloudPlaylistPage {
    collection?: any[];
    next_href?: string | null;
}

function normalizeArtworkUrl(url: string | null | undefined): string {
    if (!url) return '';
    return url.replace('-large', '-t500x500');
}

function mergeHeaders(initHeaders: HeadersInit | undefined, additions: Record<string, string>): HeadersInit {
    const headers: Record<string, string> = { ...additions };
    if (!initHeaders) return headers;

    if (initHeaders instanceof Headers) {
        initHeaders.forEach((value, key) => {
            headers[key] = value;
        });
    } else if (Array.isArray(initHeaders)) {
        for (const [key, value] of initHeaders) {
            headers[key] = value;
        }
    } else {
        Object.assign(headers, initHeaders);
    }

    return headers;
}

async function soundcloudFetch(url: string, token: string, init: RequestInit = {}): Promise<any> {
    const targetUrl = url.startsWith('http://') || url.startsWith('https://')
        ? url
        : `${SOUNDCLOUD_API_BASE}${url.startsWith('/') ? url : `/${url}`}`;
    const headers = mergeHeaders(init.headers, {
        Authorization: `OAuth ${token}`,
        Accept: 'application/json',
    });

    const response = await fetch(targetUrl, { ...init, headers });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`SoundCloud request failed (${response.status}): ${text}`);
    }
    if (response.status === 204) return null;
    return response.json();
}

async function fetchSoundcloudPlaylists(accessToken: string): Promise<Playlist[]> {
    const results: Playlist[] = [];
    let nextUrl: string | null = `/me/playlists?limit=${DEFAULT_PAGE_LIMIT}&linked_partitioning=1`;

    while (nextUrl) {
        const page: SoundCloudPlaylistPage = await soundcloudFetch(nextUrl, accessToken);
        const collection = Array.isArray(page?.collection) ? page.collection : Array.isArray(page as any) ? page as any : [];

        for (const item of collection) {
            if (!item?.id) continue;
            const playlistId = item.id?.toString();
            const artwork = normalizeArtworkUrl(item.artwork_url || item?.tracks?.[0]?.artwork_url);
            const trackCount = typeof item.track_count === 'number'
                ? item.track_count
                : Array.isArray(item.tracks) ? item.tracks.length : 0;
            const playlist: Playlist = {
                id: playlistId,
                name: item.title ?? '',
                description: item.description ?? '',
                trackCount,
                href: item.permalink_url ?? '',
                image: artwork,
                ownerName: item.user?.username ?? '',
                public: (item.sharing ?? 'public') === 'public',
            };
            results.push(playlist);
        }

        nextUrl = page?.next_href ?? null;
    }

    return results;
}

API_router.get('/soundcloud/fetchPlaylist', async (req, res) => {
    try {
        const shouldFetch = req.query.fetch === 'true';
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const userDoc = await db.collection<UserDoc>('users').findOne({ _id: userId });
        if (!userDoc || !Array.isArray(userDoc.oauth))
            return res.status(401).json({ error: 'User not setup' });

        if (!shouldFetch) {
            const existing = await db.collection('soundcloud').findOne({ _id: userId });
            if (existing?.playlists)
                return res.status(202).json({ playlists: existing.playlists, updatedAt: existing.updatedAt });
        }

        const soundcloudOauth = userDoc.oauth.find(o => o.provider === 'soundcloud');
        if (!soundcloudOauth) return res.status(400).json({ error: 'SoundCloud not linked' });

        const playlists = await fetchSoundcloudPlaylists(soundcloudOauth.accessToken);
        const now = new Date();

        await db.collection('soundcloud').updateOne(
            { _id: userId },
            { $set: { playlists, updatedAt: now } },
            { upsert: true }
        );

        return res.status(200).json({ playlists, updatedAt: now });
    } catch (error) {
        console.error('Error in /soundcloud/fetchPlaylist:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
