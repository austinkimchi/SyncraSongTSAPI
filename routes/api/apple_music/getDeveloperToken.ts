/**
 * @route GET /apple/devToken
 * @desc Provides an Apple Music developer token for authenticated users
 * @access Private (authenticated users JWT required)
 */
import {
    API_router, db, getUserId,
    APPLE_MUSICKIT_KEYID,
    APPLE_MUSICKIT_TEAMID,
    APPLE_PRIVATE_KEY
} from '../api.js';
import jwt from 'jsonwebtoken';

API_router.get('/apple_music/devToken', async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        // sign a jwt token for Apple Music developer token
        const developerToken = await getDeveloperToken();

        return res.status(200).json({ developerToken });
    } catch (err) {
        console.error('Error in /apple_music/devToken:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Default TTL 300 seconds = 5 minutes
export async function getDeveloperToken(TTL = 300): Promise<string> {
    return jwt.sign(
        {
            iss: APPLE_MUSICKIT_TEAMID,                 // Your 10-character Team ID
            iat: Math.floor(Date.now() / 1000),         // Current Unix time in seconds
            exp: Math.floor(Date.now() / 1000) + TTL    // Unix time in seconds (max 6 months)
        },
        APPLE_PRIVATE_KEY,
        {
            algorithm: 'ES256',
            header: {
                alg: 'ES256',
                kid: APPLE_MUSICKIT_KEYID
            }
        }
    );
}