import type { UserDoc } from "../../types/database.js";
import { AUTH_router, db, jwt, JWT_SECRET } from "./auth.js";

/**
 * @description Retrieves user information based on the provided JWT token.
 * @route GET /auth/info
 * @access Private
 * @header {string} Authorization - Bearer token containing the JWT.
 * @returns {object} - User information or error message.
 */
AUTH_router.get('/info', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader)
            return res.status(401).json({ message: 'Authorization header missing' });
        const token = authHeader.split(' ')[1];
        if (!token)
            return res.status(401).json({ message: 'Token missing from Authorization header' });

        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded || typeof decoded !== 'object' || !('userId' in decoded))
            return res.status(400).json({ message: 'Malformed JWT' });
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne<UserDoc>(
            { _id: decoded.userId },
            { projection: { "oauth.accessToken": 0 } } // Exclude access tokens from response
        );
        if (!user) return res.status(404).json({ message: 'User not found' });

        res.status(200).json({ _id: user._id, oauth: user.oauth || [] });
    } catch (err) {
        console.error(err);
        if (err instanceof jwt.JsonWebTokenError)
            return res.status(401).json({ message: 'Invalid token' });

        next();
    }
});