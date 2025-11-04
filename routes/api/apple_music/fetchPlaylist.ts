import { API_router, db, getUserId } from '../api.js';
import type { UserDoc } from '../../../types/database.js';
import type { Playlist } from '../../auth/playlist.js';
import jwt from 'jsonwebtoken';
import { getDeveloperToken } from './getDeveloperToken.js';


API_router.get('/apple_music/fetchPlaylist', async (req, res) => {
    try {
        const fetch = req.query.fetch === 'true';

        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const userDoc = await db.collection('users').findOne({ _id: userId as any }) as UserDoc | null;
        if (!userDoc || !userDoc.oauth) return res.status(401).json({ error: 'User not setup' });

        if (!fetch) {
            const appleData = await db.collection('apple_music').findOne({ _id: userId as any });
            if (appleData && appleData.playlists)
                return res.status(202).json({ playlists: appleData.playlists });
        }

        // get the oauth of provider: apple_music only
        const appleOauth = userDoc.oauth.find(o => o.provider === 'apple_music');
        if (!appleOauth) return res.status(400).json({ error: 'Apple Music not linked' });

        const musicUserToken = appleOauth.accessToken;
        const playlists = await parsedApplePlaylist(musicUserToken);

        // store playlists in DB
        await db.collection('apple_music').updateOne(
            { _id: userId as any },
            { $set: { playlists } },
            { upsert: true }
        );

        return res.status(200).json({ playlists });
    } catch (err) {
        console.error('Error in /apple_music/fetchPlaylist:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

const appleAPI = 'https://api.music.apple.com/v1/me/library/playlists';
async function parsedApplePlaylist(musicUserToken: string): Promise<Playlist[]> {
    const developerToken = await getDeveloperToken();
    const appleConfig = {
        headers: {
            'Authorization': `Bearer ${developerToken}`,
            'Music-User-Token': musicUserToken,
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip'
        },
        params: {
            limit: 100,
            offset: 0,
            'fields[playlists]': 'name,description,artwork,playParams,isPublic',
            'fields[tracks]': 'durationInMillis,isrc'
        }
    }

    const response = await fetch(appleAPI, appleConfig);
    const data = await response.json();

    const playlists: Playlist[] = data.data.map((pl: any) => ({
        id: pl.id,
        name: pl.attributes.name,
        description: pl.attributes?.description?.standard || '',
        trackCount: pl.attributes.trackCount || 0,
        href: '', // TODO:
        image: pl.attributes.artwork ? pl.attributes.artwork.url.replace('{w}x{h}', '300x300') : '',
        ownerName: '', // TODO:
        public: pl.attributes.isPublic || false
    }));

    return playlists;
}