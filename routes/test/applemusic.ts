import { TEST_router } from "./test.js";
import { AppleMusicTransferProvider } from "../../services/transfer/providers/appleMusic.js";
import type { OAuthEntry } from "../../types/database.js";

TEST_router.get("/applemusic/search", async (req, res) => {
    const { q, artists, duration, accessToken } = req.query;
    if (typeof q !== 'string' || q.trim() === '') {
        return res.status(400).json({ error: 'Missing or invalid query parameter "q"' });
    } else if (typeof artists !== 'string' || artists.trim() === '') {
        return res.status(400).json({ error: 'Missing or invalid query parameter "artists"' });
    } else if (typeof accessToken !== 'string' || accessToken.trim() === '') {
        return res.status(400).json({ error: 'Missing or invalid query parameter "accessToken"' });
    } else if (duration && isNaN(Number(duration))) {
        return res.status(400).json({ error: 'Invalid query parameter "duration"' });
    }

    try {
        const oauthEntry: OAuthEntry = {
            provider: 'apple_music',
            accessToken: typeof accessToken === 'string' ? accessToken : '',
            refreshToken: '',
            providerId: '',
        };

        const AMTP = new AppleMusicTransferProvider(oauthEntry);
        const result = await AMTP.matchByMetadata(q.trim(), artists.split(',').map(e => e.trim()), Number(duration));
        return res.json({ result });
    } catch (error) {
        console.error("Error searching Apple Music:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

TEST_router.get("/applemusic/search/isrc", async (req, res) => {
    const { isrc, accessToken } = req.query;
    if (typeof isrc !== 'string' || isrc.trim() === '') {
        return res.status(400).json({ error: 'Missing or invalid query parameter "isrc"' });
    } else if (typeof accessToken !== 'string' || accessToken.trim() === '') {
        return res.status(400).json({ error: 'Missing or invalid query parameter "accessToken"' });
    }

    try {
        const oauthEntry: OAuthEntry = {
            provider: 'apple_music',
            accessToken: typeof accessToken === 'string' ? accessToken : '',
            refreshToken: '',
            providerId: '',
        };

        const AMTP = new AppleMusicTransferProvider(oauthEntry);
        const result = await AMTP.matchTracksByIsrc([isrc.trim()]);
        return res.json({ result: Array.from(result.values()) });
    } catch (error) {
        console.error("Error searching Apple Music by ISRC:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});