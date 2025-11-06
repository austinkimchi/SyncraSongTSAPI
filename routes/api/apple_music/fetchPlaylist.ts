import { API_router, db, getUserId } from '../api.js';
import type { UserDoc } from '../../../types/database.js';
import type { Playlist } from '../../auth/playlist.js';
import { getDeveloperToken } from './getDeveloperToken.js';


API_router.get('/apple_music/fetchPlaylist', async (req, res) => {
    try {
        const fetch = req.query.fetch === 'true';

        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const userDoc = await db.collection('users').findOne({ _id: userId }) as UserDoc | null;
        if (!userDoc || !userDoc.oauth) return res.status(401).json({ error: 'User not setup' });

        if (!fetch) {
            const appleData = await db.collection('apple_music').findOne({ _id: userId });
            if (appleData && appleData.playlists)
                return res.status(202).json({ playlists: appleData.playlists, updatedAt: appleData.updatedAt });
        }

        // get the oauth of provider: apple_music only
        const appleOauth = userDoc.oauth.find(o => o.provider === 'apple_music');
        if (!appleOauth) return res.status(400).json({ error: 'Apple Music not linked' });

        const musicUserToken = appleOauth.accessToken;
        const playlists = await parsedApplePlaylist(musicUserToken);
        const now = new Date();

        // store playlists in DB
        await db.collection('apple_music').updateOne(
            { _id: userId },
            { $set: { playlists, updatedAt: now } },
            { upsert: true }
        );

        return res.status(200).json({ playlists, updatedAt: now });
    } catch (err) {
        console.error('Error in /apple_music/fetchPlaylist:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

const APPLE_BASE = "https://api.music.apple.com";
const LIB_PLAYLISTS = `${APPLE_BASE}/v1/me/library/playlists`;

async function parsedApplePlaylist(musicUserToken: string): Promise<Playlist[]> {
    const developerToken = await getDeveloperToken();

    const headers: Record<string, string> = {
        Authorization: `Bearer ${developerToken}`,
        "Music-User-Token": musicUserToken,
        Accept: "application/json",
    };

    const results: Playlist[] = [];

    const baseParams = new URLSearchParams({
        limit: "100",
        offset: "0",
        "fields[playlists]": "name,description,artwork,playParams,isPublic",
        "fields[tracks]": "durationInMillis",
    });

    let nextUrl: string | null = `${LIB_PLAYLISTS}?${baseParams.toString()}`;

    // Page through all library playlists
    while (nextUrl) {
        const res: any = await fetch(nextUrl, { headers });
        if (!res.ok) {
            throw new Error(`Apple Music API (playlists) failed: ${res.status} ${res.statusText}`);
        }
        const page = await res.json();

        const dataArray: any[] = Array.isArray(page?.data) ? page.data : [];

        const pagePlaylists: Playlist[] = await Promise.all(
            dataArray.map(async (pl: any): Promise<Playlist> => {
                const id: string = pl?.id;
                const name: string = pl?.attributes?.name ?? "";
                const description: string = pl?.attributes?.description?.standard ?? "";
                const isPublic: boolean = !!pl?.attributes?.isPublic;
                const globalId: string | undefined = pl?.attributes?.playParams?.globalId;
                const href = globalId ? `https://music.apple.com/playlist/${globalId}` : "";
                const image =
                    pl?.attributes?.artwork?.url
                        ? pl.attributes.artwork.url.replace("{w}x{h}", "300x300")
                        : "";
                const detailParams = new URLSearchParams({ include: "tracks" });
                const detailUrl = `${LIB_PLAYLISTS}/${encodeURIComponent(id)}?${detailParams.toString()}`;

                let trackCount = 0;
                try {
                    const detailRes = await fetch(detailUrl, { headers });
                    if (detailRes.ok) {
                        const detailJson = await detailRes.json();
                        const first = detailJson?.data?.[0];
                        trackCount = first?.relationships?.tracks?.meta?.total ?? 0;
                    } else {
                        trackCount = 0;
                    }
                } catch {
                    trackCount = 0;
                }

                return {
                    id,
                    name,
                    description,
                    trackCount,
                    href,
                    image,
                    ownerName: "",
                    public: isPublic,
                };
            })
        );

        results.push(...pagePlaylists);

        // If there's next page, handle it
        if (page?.next) {
            nextUrl = new URL(page.next, APPLE_BASE).toString();
        } else {
            nextUrl = null;
        }
    }

    return results;
}