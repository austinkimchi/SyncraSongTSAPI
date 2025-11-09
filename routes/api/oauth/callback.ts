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

        // MusicKit (Apple Music) connection (not login)
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
                            refreshToken: "", // No refresh token needed for Apple Music
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
        let providerRefreshToken = "";

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
            providerRefreshToken = tok.refresh_token!;

            // Validate token by fetching user profile
            const me = await spotifyMe(providerAccessToken);
            if (!me?.id) return res.status(401).json({ message: "spotify token invalid" });

            providerUserId = me.id;
        } else if (provider === "soundcloud") {
            if (!code) return res.status(400).json({ message: "Missing authorization code" });
            if (!cfg.clientId || !cfg.redirectUri)
                return res.status(500).json({ message: "Server missing fields for SoundCloud" });

            // Exchange code for access token
            const tok = await exchangeSoundCloudCode({
                code,
                codeVerifier: s.codeVerifier || "",
                clientId: cfg.clientId!,
                clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET!,
                redirectUri: s.redirectUri!,
            });
            providerAccessToken = tok.access_token;
            providerRefreshToken = tok.refresh_token;

            const me = await soundcloudMe(providerAccessToken);
            if (!me?.id) return res.status(401).json({ message: "soundcloud token invalid" });

            providerUserId = me.id.toString();
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
                refreshUserOAuth(existing._id).catch(err => {
                    console.error("Failed to refresh user OAuth tokens on login:", err);
                });
                // Update access token in DB
                await users.updateOne(
                    { _id: existing._id, "oauth.provider": provider },
                    { $set: { "oauth.$.accessToken": providerAccessToken, "oauth.$.refreshToken": providerRefreshToken } }
                );
                try {
                    // delete state record
                    await states.deleteOne({ _id: s._id });
                } catch (err) {
                    console.error("Failed to delete OAuth state record:", err);
                }

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
                            tempRefreshToken: providerRefreshToken,
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
                    {
                        $push: {
                            oauth: {
                                provider, providerId: providerUserId,
                                accessToken: providerAccessToken,
                                refreshToken: providerRefreshToken
                            }
                        }
                    }
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
        refresh_token: string;
        scope: string;
    };
}

async function exchangeSoundCloudCode(args: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}) {
    const body = new URLSearchParams({
        client_id: args.clientId,
        client_secret: args.clientSecret,
        redirect_uri: args.redirectUri,
        grant_type: "authorization_code",
        code: args.code,
        code_verifier: args.codeVerifier,
    });

    const r = await fetch("https://secure.soundcloud.com/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${Buffer.from(`${args.clientId}:${args.clientSecret}`).toString('base64')}`
        },
        body,
    });
    if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`soundcloud token exchange failed: ${r.status} ${txt}`);
    }

    return (await r.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        scope?: string;
        token_type: string;
    };
}

async function soundcloudMe(accessToken: string) {
    const r = await fetch("https://api.soundcloud.com/me", {
        headers: {
            "accept": 'application/json; charset=utf-8',
            "Authorization": `OAuth ${accessToken}`
        },
    });
    if (!r.ok) return null;

    return (await r.json()) as { id: number; username?: string; email?: string };
}

async function spotifyMe(accessToken: string) {
    const r = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as { id: string; display_name?: string; email?: string };
}



/**
 * Invokes when user logins; Checks all OAuth tokens for the user and refreshes them.
 * @param userId 
 * @param provider 
 */
async function refreshUserOAuth(userId: string): Promise<void> {
    const user = await db.collection<UserDoc>("users").findOne({ _id: userId });
    if (!user || !user.oauth) return;
    console.log(`Refreshing OAuth tokens for user ${userId} with ${user.oauth.length} providers.`);

    for (const entry of user.oauth) {
        if (entry.provider === "apple_music") continue; // Apple Music has non-expiring tokens
        const cfg = PROVIDERS[entry.provider];
        if (!cfg || !entry.refreshToken) continue;
        try {
            let newTokens: { accessToken: string; refreshToken?: string };
            switch (entry.provider) {
                case "spotify":
                    newTokens = await refreshSpotifyToken(entry.refreshToken);
                    break;
                case "soundcloud":
                    newTokens = await refreshSoundCloudToken(entry.refreshToken);
                    break;
                default:
                    continue;
            }
            await db.collection<UserDoc>("users").updateOne(
                { _id: userId, "oauth.provider": entry.provider },
                {
                    $set: {
                        "oauth.$.accessToken": newTokens.accessToken,
                        ...(newTokens.refreshToken ? { "oauth.$.refreshToken": newTokens.refreshToken } : {})
                    }
                }
            );
        } catch (err) {
            console.error(`Failed to refresh ${entry.provider} token for user ${userId}:`, err);
        }
    }

    return;
}

async function refreshSpotifyToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string }> {
    const cfg = PROVIDERS['spotify'];
    if (!cfg.clientId || !cfg.clientSecret) throw new Error("Spotify provider is not properly configured.");
    const url = new URL("https://accounts.spotify.com/api/token");
    const body = new URLSearchParams();
    body.append('grant_type', 'refresh_token');
    body.append('refresh_token', refreshToken);

    const resp = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64'),
        },
        body: body.toString(),
    });
    if (!resp.ok) throw new Error(`Failed to refresh Spotify token: ${resp.status} ${resp.statusText}`);

    const data = await resp.json();
    console.log(`Spotify token refreshed successfully.`, data);
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
    };
}

async function refreshSoundCloudToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string }> {
    const cfg = PROVIDERS['soundcloud'];
    if (!cfg.clientId || !cfg.clientSecret) throw new Error("SoundCloud provider is not properly configured.");
    const url = new URL("https://secure.soundcloud.com/oauth/token");
    const body = new URLSearchParams();
    body.append('grant_type', 'refresh_token');
    body.append('client_id', cfg.clientId);
    body.append('client_secret', cfg.clientSecret);
    body.append('refresh_token', refreshToken);
    const resp = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            'accept': 'application/json; charset=utf-8',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });
    if (!resp.ok) throw new Error(`Failed to refresh SoundCloud token: ${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
    };
}
