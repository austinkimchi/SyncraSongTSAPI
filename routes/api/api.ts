import express from 'express';
import { db } from '../../mongo.js';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { join } from 'path';

// Validate all environment variables needed
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not defined in environment variables');
if (!process.env.SPOTIFY_CLIENT_ID) throw new Error('SPOTIFY_CLIENT_ID not defined in environment variables');
if (!process.env.SPOTIFY_CLIENT_SECRET) throw new Error('SPOTIFY_CLIENT_SECRET not defined in environment variables');
if (!process.env.SPOTIFY_REDIRECT_URI) throw new Error('SPOTIFY_REDIRECT_URI not defined in environment variables');
if (!process.env.SPOTIFY_SCOPES) throw new Error('SPOTIFY_SCOPES not defined in environment variables');
if (!process.env.APPLE_MUSICKIT_TEAMID) throw new Error('APPLE_MUSICKIT_TEAMID not defined in environment variables');
if (!process.env.APPLE_MUSICKIT_KEYID) throw new Error('APPLE_MUSICKIT_KEYID not defined in environment variables');
if (!process.env.APPLE_MUSICKIT_P8PATH) throw new Error('APPLE_MUSICKIT_PRIVATEKEY_PATH not defined in environment variables');
if (!process.env.SOUNDCLOUD_CLIENT_ID) throw new Error('SOUNDCLOUD_CLIENT_ID not defined in environment variables');
if (!process.env.SOUNDCLOUD_CLIENT_SECRET) throw new Error('SOUNDCLOUD_CLIENT_SECRET not defined in environment variables');
if (!process.env.SOUNDCLOUD_REDIRECT_URI) throw new Error('SOUNDCLOUD_REDIRECT_URI not defined in environment variables');

export const JWT_SECRET = process.env.JWT_SECRET;

// Spotify OAuth config
export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
export const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;
export const SPOTIFY_SCOPES = process.env.SPOTIFY_SCOPES.split(',');

// Apple Music OAuth config
export const APPLE_MUSICKIT_TEAMID = process.env.APPLE_MUSICKIT_TEAMID;
export const APPLE_MUSICKIT_KEYID = process.env.APPLE_MUSICKIT_KEYID;
const privateKeyPath = join(process.cwd(), process.env.APPLE_MUSICKIT_P8PATH);
export const APPLE_PRIVATE_KEY  = fs.readFileSync(privateKeyPath, 'utf8');

export const API_router = express.Router();
export { db, jwt };
export default API_router;

// Load routes
(async () => {
    loadRoutesFromDirectory('oauth');
    loadRoutesFromDirectory('spotify');
    loadRoutesFromDirectory('apple_music');
    loadRoutesFromDirectory('soundcloud');
    import('./transfer.js');
})();

function loadRoutesFromDirectory(directory: string) {
    const routeFiles = fs.readdirSync(new URL(`./${directory}`, import.meta.url));
    for (const file of routeFiles) {
        if (file.endsWith('.js')) {
            import(`./${directory}/${file}`);
        }
    }
}

/**
 * 
 * @param token - JWT Token
 * @returns - userId if valid, null otherwise
 */
function verifyJWT(token: string): string | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any; // TODO strict type
        return decoded.userId;
    } catch (err) {
        return null;
    }
}

/**
 * @param req - Express request
 * @returns - userId if valid, null otherwise
 */
export function getUserId(req: express.Request): any {
    const authHeader = req.headers;
    if (!authHeader) return null;
    const token = authHeader.authorization?.split(' ')[1] as string;
    const userId = verifyJWT(token);
    return userId;
}