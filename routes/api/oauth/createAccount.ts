import { API_router, db, jwt } from "../api.js";
import type { Provider } from "../../../types/general.js";
import type { StateDoc } from "../../../types/oauth.js";
import type { UserDoc } from "../../../types/database.js";
import type { StringValue } from "ms";
import { createHash } from "crypto";

/**
 * @route POST /oauth/create-account
 */
API_router.post("/oauth/create-account", async (req, res, next) => {
    try {
        const { state, username, password } = req.body as {
            state: string;
            username: string;
            password?: string;
        };

        if (!state || !username) {
            return res.status(400).json({ message: "state, username, password are required" });
        }

        const states = db.collection<StateDoc>("oauth_states");
        const s = await states.findOne({ state });

        if (!s) return res.status(400).json({ message: "Invalid state" });
        if (isExpired(s.createdAt)) return res.status(400).json({ message: "State expired" });
        if (s.intent !== "login") return res.status(400).json({ message: "State not for signup" });
        if (!s.tempProviderUserId || !s.tempAccessToken || !s.tempRefreshToken) //  this shouldn't happen
            return res.status(400).json({ message: "Missing provider credentials on state" });

        const provider = s.provider as Provider;
        const providerUserId = s.tempProviderUserId;
        const providerAccessToken = s.tempAccessToken;
        const providerRefreshToken = s.tempRefreshToken;

        const users = db.collection<UserDoc>("users");

        // THIS SHOULDN'T HAPPEN (but safeguard anyway):
        // Prevent duplicate signup if someone else already created this account via the same provider
        const existingByProvider = await users.findOne({
            "oauth.provider": provider,
            "oauth.providerId": providerUserId,
        });

        if (existingByProvider) {
            // Link state to already existing account: consume state and return signin JWT
            await states.updateOne({ _id: s._id }, { $set: { consumedAt: new Date() } });
            const appJwt = jwt.sign(
                { userId: existingByProvider._id },
                process.env.JWT_SECRET as string,
                { expiresIn: process.env.JWT_EXPIRES_IN as StringValue }
            );
            return res.status(200).json({
                nextAction: "signin",
                jwt: appJwt,
                user: { _id: existingByProvider._id },
            });
        }

        // Confirm username is not taken
        const existingByUsername = await users.findOne({ _id: username });
        if (existingByUsername)
            return res.status(409).json({ message: "Username already exists" });

        const newUser: UserDoc = {
            _id: username,
            oauth: [
                {
                    provider,
                    providerId: providerUserId,
                    accessToken: providerAccessToken,
                    refreshToken: providerRefreshToken,
                },
            ],
        };
        if (password) newUser.password = hashPassword(password);


        await users.insertOne(newUser);

        // Consume the state
        await states.updateOne({ _id: s._id }, { $set: { consumedAt: new Date() } });

        // Issue app JWT
        const appJwt = jwt.sign(
            { userId: newUser._id },
            process.env.JWT_SECRET as string,
            { expiresIn: process.env.JWT_EXPIRES_IN as StringValue }
        );

        return res.status(201).json({
            nextAction: "signin",
            jwt: appJwt,
            user: { _id: newUser._id },
        });
    } catch (err) {
        console.error(err);
        next(err);
    }
});

function isExpired(createdAt: Date, maxMs = 10 * 60_000) {
    return Date.now() - createdAt.getTime() > maxMs;
}


function hashPassword(password: string): string {
    const hash = createHash('sha256');
    hash.update(password);
    return hash.digest('hex');
}