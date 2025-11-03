import { AUTH_router, db, jwt } from "./auth.js";
import type { StringValue } from "ms";

/**
 * @description Handles user login. (Legacy Model)
 * @route POST /auth/login
 * @access Public
 */
AUTH_router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ message: 'Username and password are required' });

        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ _id: username });

        if (!user || user.password !== password)
            return res.status(401).json({ message: 'Invalid credentials' });


        const token = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.JWT_SECRET as string,
            { expiresIn: process.env.JWT_EXPIRES_IN as StringValue }
        );

        res.status(200).json({ token: token });
    } catch (err) {
        console.error(err);
        next();
    }
});