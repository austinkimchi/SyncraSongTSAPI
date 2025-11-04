import { API_router, db, getUserId, jwt } from "../api.js";
import type { Provider } from "../../../types/general.js";
import type { ProviderConfig, StateDoc } from "../../../types/oauth.js";
import { PROVIDERS } from "../../../types/oauth.js";
import type { UserDoc } from "../../../types/database.js";
import type { StringValue } from "ms";

API_router.all("/oauth/callback/:provider", async (req, res, next) => {
    try {
        const providerParam = (req.params.provider || req.query.provider || req.body.provider) as Provider;
        const provider = providerParam as Provider;
        const state = (req.query.state || req.body.state) as string | undefined;
        const code = (req.query.code || req.body.code) as string | undefined;
        const tokenFromBody = req.body?.token as string | undefined; // e.g., Apple Music user token
        if (!provider) return res.status(400).json({ message: "provider required" });

        if (provider == "apple_music" && !state) {
            if (!tokenFromBody) return res.status(400).json({ message: "Missing Music User Token" });
            const userId = getUserId(req);
            if (!userId) return res.status(401).json({ message: "Unauthorized" });

            // check if already linked
            const userDoc = await db.collection<UserDoc>("users").findOne({ _id: userId });
            if (userDoc?.oauth?.some(o => o.provider === "apple_music")) {
                await db.collection<UserDoc>("users").updateOne(
                    { _id: userId },
                    { $pull: { oauth: { provider: "apple_music" } } }
                );
            }

            // Apple Music does not provide a user ID in this flow
            await db.collection<UserDoc>("users").updateOne(
                { _id: userId },
                {
                    $push: {
                        oauth: {
                            provider: "apple_music",
                            providerId: "", // No user ID available from Apple Music
                            accessToken: decodeURI(tokenFromBody),
                        },
                    }
                }
            );

            return res.json({ info: "connected", providerLinked: provider });
        }

        if (!state) return res.status(400).json({ message: "state required" });


        const cfg: ProviderConfig | undefined = PROVIDERS[provider];
        if (!cfg) return res.status(400).json({ message: "Unsupported provider" });

        //  Look up state in DB
        const states = db.collection<StateDoc>("oauth_states");
        const s = await states.findOne({ state, provider });
        if (!s || isExpired(s.createdAt))
            return res.status(400).json({ message: "Invalid or expired state" });


        let providerUserId = "";
        let providerAccessToken = "";

        if (provider === "spotify") {
            if (!code) return res.status(400).json({ message: "Missing authorization code" });
            if (!s.codeVerifier || !s.redirectUri || !cfg.clientId)
                return res.status(500).json({ message: "Server missing PKCE fields for Spotify" });


            // Exchange code for access token
            const tok = await exchangeSpotifyCode({
                code,
                clientId: cfg.clientId!,
                redirectUri: s.redirectUri!,
                codeVerifier: s.codeVerifier!,
            });
            providerAccessToken = tok.access_token;

            // Validate token by fetching user profile
            const me = await spotifyMe(providerAccessToken);
            if (!me?.id) return res.status(401).json({ message: "spotify token invalid" });
            providerUserId = me.id;
        }

        // Intent: login, connect
        const users = db.collection<UserDoc>("users");

        if (s.intent === "login") {
            // Try to find an existing user by providerId
            const existing = await users.findOne({
                "oauth.provider": provider,
                "oauth.providerId": providerUserId,
            });

            await states.updateOne({ _id: s._id }, { $set: { usedAt: new Date() } });

            if (existing) {
                // Update access token in DB
                await users.updateOne(
                    { _id: existing._id, "oauth.provider": provider },
                    { $set: { "oauth.$.accessToken": providerAccessToken } });

                // delete state record
                await states.deleteOne({ _id: s._id });

                // Sign the app JWT
                const appJwt = jwt.sign(
                    { userId: existing._id },
                    process.env.JWT_SECRET as string,
                    { expiresIn: process.env.JWT_EXPIRES_IN as StringValue }
                );
                return res.status(200).json({
                    info: "signin",
                    jwt: appJwt,
                    userId: { _id: existing._id },
                });
            } else {
                // insert temp provider info into state for later account creation
                await states.updateOne(
                    { _id: s._id },
                    {
                        $set: {
                            tempProviderUserId: providerUserId,
                            tempAccessToken: providerAccessToken,
                        }
                    }
                );

                return res.status(200).json({
                    info: "complete-signup",
                    state: state
                });
            }
        }

        if (s.intent === "connect") {
            if (!s.userId)
                return res.status(400).json({ message: "Missing user context for connect intent" });

            // Update existing provider entry or push a new one
            const upd = await users.updateOne(
                { _id: s.userId, "oauth.provider": provider },
                { $set: { "oauth.$.accessToken": providerAccessToken, "oauth.$.providerId": providerUserId } }
            );
            if (upd.matchedCount === 0) {
                await users.updateOne(
                    { _id: s.userId },
                    { $push: { oauth: { provider, providerId: providerUserId, accessToken: providerAccessToken } } }
                );
            }

            await states.updateOne({ _id: s._id }, { $set: { usedAt: new Date() } });

            return res.json({ info: "connected", providerLinked: provider });
        }

        return res.status(400).json({ message: "Unknown intent" });
    } catch (err) {
        console.error(err);
        next(err);
    }
});

function isExpired(createdAt: Date, maxMs = 10 * 60_000) {
    return Date.now() - createdAt.getTime() > maxMs;
}
async function exchangeSpotifyCode(args: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
}) {
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: args.redirectUri,
        client_id: args.clientId,
        code_verifier: args.codeVerifier,
    });

    const r = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`spotify token exchange failed: ${r.status} ${txt}`);
    }
    return (await r.json()) as {
        access_token: string;
        token_type: "Bearer";
        expires_in: number;
        refresh_token?: string;
        scope?: string;
    };
}
async function spotifyMe(accessToken: string) {
    const r = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as { id: string; display_name?: string; email?: string };
}
