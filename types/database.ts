import type { Provider } from "./general.js";

export interface OAuthEntry {
    provider: Provider;
    accessToken: string;
    providerId: string;
}
export interface UserDoc {
    _id: string;            // username    
    password?: string;      // password
    oauth?: OAuthEntry[];   // array of oauth entries
}