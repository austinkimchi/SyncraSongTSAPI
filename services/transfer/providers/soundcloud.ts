import type { OAuthEntry } from "../../../types/database.js";
import {
    featRegex,
    parenRegex,
    type PlaylistResolution,
    type SourcePlaylist,
    type TrackMatchResult,
    type TransferProvider,
    type TransferTrack,
} from "../types.js";

const SOUNDCLOUD_API_BASE = "https://api.soundcloud.com";
const SEARCH_LIMIT = 10;

type SoundCloudUser = { id: number; username?: string };
type SoundCloudTrack = {
    id?: number;
    title?: string;
    duration?: number;
    user?: { username?: string };
    publisher_metadata?: {
        artist?: string;
        isrc?: string;
        urn?: string;
        upc?: string;
        release_title?: string;
    };
    artwork_url?: string | null;
    created_at?: string;
};

type SoundCloudPlaylist = {
    id?: number;
    title?: string;
    description?: string | null;
    sharing?: string;
    track_count?: number;
    tracks?: SoundCloudTrack[];
    user?: { username?: string };
};

type SoundCloudCollectionResponse<T> = {
    collection?: T[];
    next_href?: string | null;
};

function mergeHeaders(initHeaders: HeadersInit | undefined, extra: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (!initHeaders) return headers;

    if (initHeaders instanceof Headers) {
        initHeaders.forEach((value, key) => {
            headers[key] = value;
        });
    } else if (Array.isArray(initHeaders)) {
        for (const [key, value] of initHeaders) {
            headers[key] = value;
        }
    } else {
        Object.assign(headers, initHeaders);
    }

    return headers;
}

export class SoundCloudTransferProvider implements TransferProvider {
    public readonly provider = "soundcloud" as const;
    private readonly oauth: OAuthEntry;

    constructor(oauth: OAuthEntry) {
        if (!oauth.accessToken) throw new Error("SoundCloud OAuth entry missing access token");
        this.oauth = oauth;
    }

    private async request(url: string, init: RequestInit = {}): Promise<any> {
        const targetUrl = url.startsWith("http://") || url.startsWith("https://")
            ? url
            : `${SOUNDCLOUD_API_BASE}${url.startsWith("/") ? url : `/${url}`}`;
        const headers = mergeHeaders(init.headers, {
            Authorization: `OAuth ${this.oauth.accessToken}`,
            Accept: "application/json",
        });
        if (init.body && !("Content-Type" in headers)) {
            headers["Content-Type"] = "application/json";
        }
        const response = await fetch(targetUrl, { ...init, headers });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`SoundCloud API error ${response.status}: ${text}`);
        }
        if (response.status === 204) return null;
        return response.json();
    }

    private extractTracks(data: SoundCloudTrack[] | undefined): TransferTrack[] {
        if (!Array.isArray(data)) return [];
        return data.map((track): TransferTrack => {
            const artists: string[] = [];
            if (track.publisher_metadata?.artist) artists.push(track.publisher_metadata.artist);
            if (track.user?.username && !artists.includes(track.user.username)) artists.push(track.user.username);

            const transferTrack: TransferTrack = {
                id: track.id?.toString() ?? "",
                name: track.title ?? "",
                artists,
                upc: track.publisher_metadata?.upc ?? null,
                raw: track
            };

            const releaseTitle = track.publisher_metadata?.release_title;
            if (releaseTitle) transferTrack.album = releaseTitle;

            const isrc = track.publisher_metadata?.isrc?.trim();
            if (isrc) transferTrack.isrc = isrc;

            if (typeof track.duration === "number") transferTrack.durationMs = track.duration;

            return transferTrack;
        });
    }

    async getPlaylist(playlistId: string): Promise<SourcePlaylist> {
        const playlist: SoundCloudPlaylist = await this.request(`/playlists/${encodeURIComponent(playlistId)}?representation=full`);
        if (!playlist?.id) throw new Error("SoundCloud playlist not found");

        const tracks = this.extractTracks(playlist.tracks);
        return {
            id: playlist.id.toString(),
            name: playlist.title ?? "Untitled Playlist",
            description: playlist.description ?? null,
            public: (playlist.sharing ?? "public") === "public",
            tracks,
        };
    }

    private async searchTracks(params: string): Promise<SoundCloudTrack[]> {
        const response: SoundCloudCollectionResponse<SoundCloudTrack> | SoundCloudTrack[] = await this.request(`/tracks?${params}`);
        if (Array.isArray(response)) return response;
        if (Array.isArray(response?.collection)) return response.collection;
        return [];
    }

    async matchTracksByUPC(upcs: string[]): Promise<Map<string, TrackMatchResult>> {
        const matches = new Map<string, TrackMatchResult>();
        for (const upc of upcs) {
            const trimmed = upc.trim();
            if (!trimmed) continue;
            const results = await this.searchTracks(`linked_partitioning=1&limit=${SEARCH_LIMIT}&filter=public&q=${encodeURIComponent(trimmed)}`);
            const track = results.find(t => t.publisher_metadata?.upc?.toLowerCase() === trimmed.toLowerCase());
            if (track?.id) {
                const match: TrackMatchResult = {
                    upc: trimmed,
                    providerTrackId: track.id.toString(),
                };
                if (track.created_at) match.created_at = new Date(track.created_at);
                if (track.title) match.name = track.title;
                if (track.user?.username) match.artists = [track.user.username];
                matches.set(trimmed, match);
            }
        }
        return matches;
    }

    async matchTracksByIsrc(isrcs: string[]): Promise<Map<string, TrackMatchResult>> {
        const matches = new Map<string, TrackMatchResult>();
        for (const isrc of isrcs) {
            const trimmed = isrc.trim();
            if (!trimmed) continue;
            const results = await this.searchTracks(`linked_partitioning=1&limit=${SEARCH_LIMIT}&filter=public&isrc=${encodeURIComponent(trimmed)}`);
            const track = results.find(t => t.publisher_metadata?.isrc?.toLowerCase() === trimmed.toLowerCase());
            if (track?.id) {
                const match: TrackMatchResult = {
                    isrc: trimmed,
                    providerTrackId: track.id.toString(),
                };
                if (track.title) match.name = track.title;
                if (track.user?.username) match.artists = [track.user.username];
                matches.set(trimmed, match);
                continue;
            }

            const fallbackResults = await this.searchTracks(`linked_partitioning=1&limit=${SEARCH_LIMIT}&filter=public&q=${encodeURIComponent(trimmed)}`);
            const fallback = fallbackResults.find(t => t.publisher_metadata?.isrc?.toLowerCase() === trimmed.toLowerCase());
            if (fallback?.id) {
                const match: TrackMatchResult = {
                    isrc: trimmed,
                    providerTrackId: fallback.id.toString(),
                };
                if (fallback.title) match.name = fallback.title;
                if (fallback.user?.username) match.artists = [fallback.user.username];
                matches.set(trimmed, match);
            }
        }
        return matches;
    }

    async matchByMetadata(name: string, artists: string[], duration_ms: Number): Promise<TrackMatchResult | null> {
        // remove (fea.t. Artist) or similar from name
        name.replace(featRegex, "").trim();
        name.replace(parenRegex, "").trim();
        artists = artists.slice(0, 1);
        // const queryParts = [name, ...artists];
        // const query = queryParts.filter(Boolean).join(" ");
        const results = await this.searchTracks(`linked_partitioning=1&limit=${SEARCH_LIMIT}&filter=public&q=${encodeURIComponent(name + " " + artists.join(" "))}`);
        if (results.length === 0) return null;

        const targetDuration = Number(duration_ms) || 0;
        let best: TrackMatchResult | null = null;
        let smallestDiff = Number.MAX_SAFE_INTEGER;
        const max_diff = 5000; // 5 seconds tolerance

        for (const track of results) {
            if (!track?.id) continue;
            const duration = track.duration ?? 0;
            const diff = targetDuration > 0 ? Math.abs(duration - targetDuration) : 0;
            if (diff < smallestDiff) {
                smallestDiff = diff;
                const candidate: TrackMatchResult = {
                    providerTrackId: track.id.toString(),
                };
                if (track.title) candidate.name = track.title;
                if (track.user?.username) candidate.artists = [track.user.username];
                const isrc = track.publisher_metadata?.isrc?.trim();
                if (isrc) candidate.isrc = isrc;
                best = candidate;
                if (diff === 0 && targetDuration > 0) break;
            }
        }
        if (smallestDiff > max_diff) return null;

        return best;
    }

    async matchByMetadatas(tracks: TransferTrack[]): Promise<Map<string, TrackMatchResult>> {
        const matches = new Map<string, TrackMatchResult>();
        for (const track of tracks) {
            const match = await this.matchByMetadata(track.name, track.artists, track.durationMs || 0);
            if (match) {
                matches.set(track.id, match);
            }
        }
        return matches;
    }

    async ensurePlaylist(options: { playlistId?: string | null; name: string; description?: string | null; public?: boolean; }): Promise<PlaylistResolution> {
        if (options.playlistId) {
            const playlist: SoundCloudPlaylist = await this.request(`/playlists/${encodeURIComponent(options.playlistId)}`);
            if (!playlist?.id) throw new Error("SoundCloud playlist not found");
            return {
                playlistId: playlist.id.toString(),
                name: playlist.title ?? options.name,
                created: false,
            };
        }

        const body = {
            playlist: {
                title: options.name,
                description: options.description ?? undefined,
                sharing: options.public === false ? "private" : "public",
                tracks: [] as Array<{ id: number }>,
            },
        };

        const created: SoundCloudPlaylist = await this.request(`/playlists`, {
            method: "POST",
            body: JSON.stringify(body),
        });

        if (!created?.id) throw new Error("Failed to create SoundCloud playlist");
        return {
            playlistId: created.id.toString(),
            name: created.title ?? options.name,
            created: true,
        };
    }

    async addTracks(playlistId: string, providerTrackIds: string[]): Promise<void> {
        if (providerTrackIds.length === 0) return;
        const playlist: SoundCloudPlaylist = await this.request(`/playlists/${encodeURIComponent(playlistId)}?representation=full`);
        if (!playlist?.id) throw new Error("SoundCloud playlist not found");

        const existingIds = Array.isArray(playlist.tracks)
            ? playlist.tracks.map(track => track.id).filter((id): id is number => typeof id === "number")
            : [];

        const additions = providerTrackIds
            .map(id => Number(id))
            .filter(id => Number.isFinite(id) && !existingIds.includes(id));

        if (additions.length === 0) return;

        const updatedTracks = [...existingIds, ...additions];
        console.log(updatedTracks.map(id => ({ "urn": `soundcloud:tracks:${id}` })))
        const payload = {
            playlist: {
                title: playlist.title ?? undefined,
                description: playlist.description ?? undefined,
                sharing: playlist.sharing ?? "public",
                tracks: updatedTracks.map(id => ({ "urn": `soundcloud:tracks:${id}` })),
            },
        };

        await this.request(`/playlists/${encodeURIComponent(playlistId)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
        });
    }
}
