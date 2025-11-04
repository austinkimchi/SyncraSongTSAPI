/**
 * @route GET /api/spotify/fetchPlaylist
 * @desc Updates the user's Spotify playlist data
 * @access Private (authenticated users JWT required)
 */
import { API_router, db } from '../api.js';
import { spotifyApi } from './spotify.js';
import type { UserDoc } from '../../../types/database.js';
import type { Playlist } from '../../auth/playlist.js';
import jwt from 'jsonwebtoken';

API_router.get('/spotify/fetchPlaylist', async (req, res) => {
    try {
        // fetch query param fetch bool
        const fetch = req.query.fetch === 'true';
        const authHeader = req.headers;

        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.authorization?.split(' ')[1] as string;
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any; // TODO strict type
        const userId = decoded.userId;

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const userDoc = await db.collection('users').findOne({ _id: userId }) as UserDoc | null;
        if (!userDoc || !userDoc.oauth) return res.status(401).json({ error: 'User not setup' });

        if (!fetch) {
            const spotifyData = await db.collection('spotify').findOne({ _id: userId });
            if (spotifyData && spotifyData.playlists)
                return res.status(202).json({ playlists: spotifyData.playlists });
        }

        // get the oauth of provider: spotify only
        const spotifyOauth = userDoc.oauth.find(o => o.provider === 'spotify');
        if (!spotifyOauth) return res.status(400).json({ error: 'Spotify not linked' });

        spotifyApi.setAccessToken(spotifyOauth.accessToken);

        // TODO: verify token is still valid, refresh if needed 

        const playlistsResponse = await spotifyApi.getUserPlaylists();
        const totalPlaylists = playlistsResponse.body.total;

        // if more than 50 playlists, need to paginate
        let allPlaylists = playlistsResponse.body.items;
        let offset = playlistsResponse.body.items.length;
        while (offset < totalPlaylists) {
            const pagedResponse = await spotifyApi.getUserPlaylists({ limit: 50, offset: offset });
            allPlaylists = allPlaylists.concat(pagedResponse.body.items);
            offset += pagedResponse.body.items.length;
        }

        // format playlist data
        const playlists: Playlist[] = playlistsResponse.body.items.map(pl => ({
            id: pl.id || '',
            description: pl.description || '',
            name: pl.name || '',
            trackCount: pl.tracks.total || 0,
            href: pl.external_urls.spotify || '',
            image: pl.images[0]?.url || '',
            ownerName: pl.owner.display_name || '',
            public: pl.public || false
        }));

        // push to database
        await db.collection('spotify').updateOne(
            { _id: userId },
            { $set: { playlists: playlists, updatedAt: new Date() } },
            { upsert: true }
        );

        return res.json({ playlists: playlists });
    } catch (error) {
        console.error('/spotify/fetchPlaylist: ', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});