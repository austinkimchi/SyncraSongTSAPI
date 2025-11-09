import type { Provider } from "./general.js";

if (!process.env.SPOTIFY_CLIENT_ID ||
    !process.env.SPOTIFY_CLIENT_SECRET ||
    !process.env.SPOTIFY_REDIRECT_URI ||
    !process.env.APPLE_MUSICKIT_CLIENTID)
    throw new Error('One or more OAuth environment variables are not set.');

if (!process.env.SOUNDCLOUD_CLIENT_ID ||
    !process.env.SOUNDCLOUD_CLIENT_SECRET ||
    !process.env.SOUNDCLOUD_REDIRECT_URI)
    throw new Error('One or more OAuth environment variables are not set.');


export type Intent = 'login' | 'connect';
export interface StateDoc {
    state: string;                      // random state string
    provider: Provider;
    intent: Intent;
    createdAt: Date;
    userId?: string | null;             // null for new users
    codeVerifier?: string | undefined;  // for PKCE
    redirectUri: string;
    tempProviderUserId?: string;        // set after validation
    tempAccessToken?: string;           // set after validation
    tempRefreshToken?: string | null;   // set after validation
}

export type ProviderConfig = {
    authUrl?: string;       // No auth URL for apple musickit
    clientId?: string;
    clientSecret?: string;
    scopes?: string[];
    usesPKCE?: boolean;
    redirectUri: string;
};

export const PROVIDERS: Record<Provider, ProviderConfig> = {
    spotify: {
        authUrl: 'https://accounts.spotify.com/authorize',
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI,
        scopes: [
            'user-read-private',
            'playlist-read-private',
            'playlist-read-collaborative',
            'playlist-modify-public',
            'playlist-modify-private',
            'ugc-image-upload',
            'user-library-read'
        ],
        usesPKCE: true
    },
    apple_music: {
        clientId: process.env.APPLE_MUSICKIT_CLIENTID,
        redirectUri: "",
    },
    soundcloud: {
        authUrl: 'https://secure.soundcloud.com/authorize',
        clientId: process.env.SOUNDCLOUD_CLIENT_ID,
        clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET,
        redirectUri: process.env.SOUNDCLOUD_REDIRECT_URI,
        scopes: [
            'non-expiring'
        ],
        usesPKCE: true
    }
}