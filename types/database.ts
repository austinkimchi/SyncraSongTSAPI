export type Provider = 'spotify' | 'apple_music' | 'soundcloud';

export interface OAuthEntry {
    provider: Provider;
    accessToken: string;
    providerId: string;
}
export interface UserDoc {
    _id: string;            // username    
    password: string;       // password
    oauth?: OAuthEntry[];   // array of oauth entries
}