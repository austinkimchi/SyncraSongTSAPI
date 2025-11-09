import type { Provider } from "../../types/general.js";

export interface TransferJobDoc {
    _id: any;
    userId: string;
    source: { provider: Provider; playlistId: string };
    target: { provider: Provider; playlistId?: string | null; createIfMissing?: boolean; name?: string };
    options?: Record<string, any>;
    meta?: Record<string, any>;
    transferredTracks?: number;
    totalTracks?: number;
}

export interface TransferTrack {
    /** Provider specific identifier (e.g. Spotify track URI) */
    id: string;
    name: string;
    artists: string[];
    album?: string;
    isrc?: string | null;
    upc?: string | null;
    durationMs?: number;
    /** Optional provider specific metadata */
    raw?: any;
}

export interface SourcePlaylist {
    id: string;
    name: string;
    description?: string | null;
    public?: boolean;
    tracks: TransferTrack[];
}

export interface PlaylistResolution {
    playlistId: string;
    name: string;
    created: boolean;
}

export interface TrackMatchResult {
    isrc?: string;
    upc?: string;
    providerTrackId: string;
    name?: string;
    artists?: string[];
}

export interface TransferProvider {
    readonly provider: Provider;
    getPlaylist(playlistId: string): Promise<SourcePlaylist>;
    /**
     * Given an array of ISRC codes, returns a map of ISRC -> provider track id (e.g. URI).
     */
    matchTracksByIsrc(isrcs: string[]): Promise<Map<string, TrackMatchResult>>;
    matchTracksByUPC(upcs: string[]): Promise<Map<string, TrackMatchResult>>;
    matchByMetadata?(name: string, artists: string[], duration_ms: Number): Promise<TrackMatchResult | null>;
    ensurePlaylist(options: {
        playlistId?: string | null;
        name: string;
        description?: string | null;
        public?: boolean;
    }): Promise<PlaylistResolution>;
    addTracks(playlistId: string, providerTrackIds: string[]): Promise<void>;
}
