import express from 'express';
import { db } from '../../mongo.js';
import jwt from 'jsonwebtoken';
import fs from 'fs';

// Validate all environment variables needed
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not defined in environment variables');
if (!process.env.SPOTIFY_CLIENT_ID) throw new Error('SPOTIFY_CLIENT_ID not defined in environment variables');
if( !process.env.SPOTIFY_CLIENT_SECRET) throw new Error('SPOTIFY_CLIENT_SECRET not defined in environment variables');
if (!process.env.SPOTIFY_REDIRECT_URI) throw new Error('SPOTIFY_REDIRECT_URI not defined in environment variables');
if (!process.env.SPOTIFY_SCOPES) throw new Error('SPOTIFY_SCOPES not defined in environment variables');

export const JWT_SECRET = process.env.JWT_SECRET;

// Spotify OAuth config
export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
export const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;
export const SPOTIFY_SCOPES = process.env.SPOTIFY_SCOPES.split(',');

export const API_router = express.Router();
export { db, jwt };
export default API_router;

// Load routes
(async () => {
    loadRoutesFromDirectory('oauth');
    loadRoutesFromDirectory('spotify');
})();

function loadRoutesFromDirectory(directory: string) {
    const routeFiles = fs.readdirSync(new URL(`./${directory}`, import.meta.url));
    for (const file of routeFiles) {
        if (file.endsWith('.js')) {
            import(`./${directory}/${file}`);
        }
    }
}