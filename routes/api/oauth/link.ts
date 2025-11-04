import { API_router, db } from "../api.js";

import type { Provider } from "../../../types/general.js";
import type { ProviderConfig, Intent, StateDoc } from "../../../types/oauth.js";
import { PROVIDERS } from "../../../types/oauth.js";
import { createHash, randomBytes } from "crypto";

/**
 * @route GET /oauth/link
 */
API_router.post('/oauth/link', async (req, res, next) => {
    try {
        const { intent, provider, redirectUri } = req.body as {
            provider: Provider;
            intent: Intent;
            redirectUri?: string;
        };
        if (!provider || !intent) return res.status(400).json({ message: 'provider and intent are required.' });

        const cfg = PROVIDERS[provider];
        if (!cfg) return res.status(400).json({ message: 'Unsupported provider.' });

        // Create state entry in database
        const state_str = randomString(48)
        const codeVerifier = cfg.usesPKCE ? randomString(64) : undefined;
        const codeChallenge = codeVerifier ? pkceChallenge(codeVerifier) : undefined;

        await db.collection<StateDoc>('oauth_states').insertOne({
            state: state_str,
            provider: provider,
            intent: intent,
            createdAt: new Date(),
            userId: null,
            codeVerifier: codeVerifier,
            redirectUri: redirectUri || cfg.redirectUri
        });

        const authorizeUrl = buildAuthorizeUrl({
            provider,
            cfg,
            state: state_str,
            codeChallenge,
            redirectUri: redirectUri || cfg.redirectUri
        });

        return res.json({
            state: state_str,
            authorizeUrl: authorizeUrl,
            codeChallengeMethod: codeChallenge ? 'S256' : undefined
        })

    } catch (err) {
        // if error is a undefined property access, likely due to missing body params
        if (err instanceof TypeError)
            return res.status(400).json({ message: 'Invalid request parameters.' });

        next();
    }
});


function randomString(len: number) {
    return randomBytes(Math.ceil(len * 0.75)).toString("base64url").slice(0, len);
}
function base64url(buffer: Buffer) {
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function pkceChallenge(verifier: string) {
    const hash = createHash("sha256").update(verifier).digest();
    return base64url(hash);
}

function buildAuthorizeUrl(opts: {
    provider: Provider;
    cfg: ProviderConfig;
    state: string;
    codeChallenge?: string | undefined; // for PKCE
    redirectUri?: string;
}) {
    const { provider, cfg, state, codeChallenge, redirectUri } = opts;
    if (!cfg.authUrl) return null;

    const url = new URL(cfg.authUrl);
    switch (provider) {
        case 'spotify':
            url.searchParams.append('response_type', 'code');
            url.searchParams.append('client_id', cfg.clientId!);
            url.searchParams.append('scope', (cfg.scopes || []).join(' '));
            url.searchParams.append('redirect_uri', redirectUri || cfg.redirectUri!);
            url.searchParams.append('state', state);
            if (cfg.usesPKCE && codeChallenge) {
                url.searchParams.append('code_challenge_method', 'S256');
                url.searchParams.append('code_challenge', codeChallenge);
            }
            break;
        default:
            return null;
    }
    return url.toString();
}