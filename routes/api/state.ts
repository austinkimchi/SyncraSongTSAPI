/**
 * @file routes/api/state.ts
 * @desc Routes for handling OAuth state management.
 * @access Public (no authentication required)
 */
import { API_router, db, jwt } from "./api";
import type { UserDoc, OAuthEntry, Provider } from "../../types/database";
import type { StringValue } from "ms";

/**
 * @route POST /api/state/callback
 * @desc Handles the callback after OAuth process to verify state.
 * @access Public
 * @body {string} state - The state string returned from the OAuth provider.
 *       {string} provider - The music platform provider (e.g., 'spotify', 'apple_music').
 *       {string} token - Provider access token.
 *       {string} providerId - The user ID from the provider.
 * @param {string} provider - The music platform provider (e.g., 'spotify', 'apple_music').
 * @param {string} state - The state string returned from the OAuth provider.
 * @returns {object} - Success or error message.
 */
API_router.post('/state/callback/:provider', async (req, res, next) => {
    // Check for required fields
    try {
        const { provider } = req.params;
        const { state, token, providerId } = req.body;

        if (!provider)
            return res.status(400).json({ message: 'Provider parameter not specified.' });
        if (!state || !token || !providerId)
            return res.status(400).json({ message: 'state, providerId, token are required.' });

        // Find state in database
        const collection = db.collection('oauth_states');
        const record = await collection.findOne({ state: state, provider: provider });

        // Could be expired or invalid state
        if (!record) return res.status(400).json({ message: 'Invalid state' });

        let userId = record.userId; // Could be new user without JWT

        if (userId) {
            const usersCollection = db.collection<UserDoc>('users');
            const user = await usersCollection.findOne({ _id: userId });
            if (!user) return res.status(400).json({ message: 'User not found for the provided state' });

            // update user profile with token for the provider
            // _id: userId, password: xyz, oauth: Array<{provider: string, accessToken: string, providerId: string}>
            const oauthEntry: OAuthEntry = {
                provider: provider as Provider,
                accessToken: token,
                providerId: providerId
            };
            await usersCollection.updateOne(
                { _id: userId },
                { $push: { oauth: oauthEntry } }
            );

        }
        return res.status(201).json({ message: 'State verified for new user' });
    } catch (err) {
        console.error(err);
        next();
    }
});

/**
 * @route POST /api/state/:provider
 * @desc Sets a state for user OAuth process.
 * @access Public
 * 
 * @param {string} provider - The music platform provider (e.g., 'spotify', 'apple_music').
 * @param {string} JWT - JSON Web Token for user identification. Could be null, send back JWT with state. (New users will not have a JWT)
 * @body {string} state - The state string to be set for the OAuth process.
 */
API_router.post('/state/:provider', async (req, res, next) => {
    try {
        const { provider } = req.params;
        const { state } = req.body;
        const JWT = req.headers.authorization || null;

        let userId = null;

        const collection = db.collection('oauth_states');
        if (JWT) {
            if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not defined in environment variables');
            const decoded = jwt.verify(JWT, process.env.JWT_SECRET);

            if (!decoded || typeof decoded !== 'object' || !('userId' in decoded))
                return res.status(400).json({ message: 'Malformed JWT' });

            userId = decoded.userId;
            await collection.updateOne(
                { userId: userId, provider: provider },
                { $set: { state: state } },
                { upsert: true }
            );
            res.status(200).json({ message: 'State set successfully' });
        } else {
            await collection.insertOne({
                userId: null,
                provider: provider,
                state: state
            });
        }
    } catch (err) {
        next(err);
    }
});

function generateRandomString(length: number) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}