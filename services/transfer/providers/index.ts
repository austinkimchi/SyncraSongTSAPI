import type { Provider } from "../../../types/general.js";
import type { OAuthEntry } from "../../../types/database.js";
import type { TransferProvider } from "../types.js";
import { SpotifyTransferProvider } from "./spotify.js";
import { AppleMusicTransferProvider } from "./appleMusic.js";

export function createTransferProvider(provider: Provider, oauth: OAuthEntry): TransferProvider {
    switch (provider) {
        case 'spotify':
            return new SpotifyTransferProvider(oauth);
        case 'apple_music':
            return new AppleMusicTransferProvider(oauth);
        default:
            throw new Error(`Provider ${provider} is not supported yet`);
    }
}
