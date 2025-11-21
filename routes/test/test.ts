import { Router } from 'express';
import { db } from '../../mongo.js';
import jwt from 'jsonwebtoken';

// Validate all environment variables needed
if (!process.env.TEST_PASSWORD) throw new Error('JWT_SECRET not defined in environment variables');

export const TEST_router = Router();
export { db, jwt };
export default TEST_router;

// Middleware, validate JWT for TEST_PASSWORD
TEST_router.use(async (req, res, next) => {
    const param = req.headers['x-test-password'] || req.query.test_password;
    if (param !== process.env.TEST_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
});

// All routes imported here
(async () => {
    await import("./soundcloud.js");
    await import("./applemusic.js")
})();



