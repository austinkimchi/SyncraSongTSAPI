import { SoundCloudTransferProvider } from "../../services/transfer/providers/soundcloud.js";
import type { OAuthEntry } from "../../types/database.js";
import { TEST_router } from "./test.js";

TEST_router.get("/soundcloud/search", async (req, res) => {
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
            provider: 'soundcloud',
            accessToken: typeof accessToken === 'string' ? accessToken : '',
            refreshToken: '',
            providerId: '',
        }

        const SCTP = new SoundCloudTransferProvider(oauthEntry);
        const result = await SCTP.matchByMetadata(q.trim(), artists.split(',').map(e => e.trim()), Number(duration));
        return res.json({ result });
    } catch (error) {
        console.error("Error searching SoundCloud:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});