import express from 'express';
import { db } from '../../mongo.js';
import fs from 'fs';
import jwt from 'jsonwebtoken';

// Validate all environment variables needed
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not defined in environment variables');

export const JWT_SECRET = process.env.JWT_SECRET;

export const API_router = express.Router();
export { db, jwt };
export default API_router;

(async () => {
    const oauthFiles = fs.readdirSync(new URL('./oauth/', import.meta.url));
    for (const file of oauthFiles) {
        if (file.endsWith('.js')) {
            await import(`./oauth/${file}`);
        }
    }
})();