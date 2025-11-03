import { Router } from 'express';
import { db } from '../../mongo.js';
import jwt from 'jsonwebtoken';

// Validate all environment variables needed
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not defined in environment variables');
if (!process.env.JWT_EXPIRES_IN) throw new Error('JWT_SECRET not defined in environment variables');

export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;

export const AUTH_router = Router();
export { db, jwt };
export default AUTH_router;

// All routes imported here
(async () => {
    await import("./login.js");
    await import("./info.js");
})();



