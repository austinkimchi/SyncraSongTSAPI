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
if (!process.env.SOUNDCLOUD_USER_CLIENT_ID)
    throw new Error("SoundCloud user client ID not defined in environment variables");

const USER_CLIENT_ID = process.env.SOUNDCLOUD_USER_CLIENT_ID;

type SoundCloudUser = { id: number; username?: string };
type SoundCloudTrack = {
    id?: number;
    title?: string;
    duration?: number;
    user?: { username?: string };
    artist?: string;
    isrc?: string;
    urn?: string;
    upc?: string;
    release_title?: string;
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
    artwork_url?: string | null;
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
            if (track?.artist) artists.push(track.artist);
            if (track.user?.username && !artists.includes(track.user.username)) artists.push(track.user.username);

            const transferTrack: TransferTrack = {
                id: track.id?.toString() ?? "",
                name: track.title ?? "",
                artists,
                upc: track.upc ?? null,
                isrc: track.isrc ?? null,
                raw: track
            };

            const isrc = track.isrc?.trim();
            if (isrc) transferTrack.isrc = isrc;

            if (typeof track.duration === "number") transferTrack.durationMs = track.duration;

            return transferTrack;
        });
    }

    async getPlaylist(playlistId: string): Promise<SourcePlaylist> {
        const playlist: SoundCloudPlaylist = await this.request(`/playlists/${encodeURIComponent(playlistId)}?access=playable,preview,blocked`);
        if (!playlist?.id) throw new Error("SoundCloud playlist not found");

        const tracks = this.extractTracks(playlist.tracks);
        return {
            id: playlist.id.toString(),
            name: playlist.title ?? "Untitled Playlist",
            description: playlist.description ?? null,
            public: (playlist.sharing ?? "public") === "public",
            image: playlist.artwork_url ?? null,
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
            const track = results.find(t => t.upc?.toLowerCase() === trimmed.toLowerCase());
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
            const track = results.find(t => t.isrc?.toLowerCase() === trimmed.toLowerCase());
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
            const fallback = fallbackResults.find(t => t.isrc?.toLowerCase() === trimmed.toLowerCase());
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

    private async alternativeSearch(name: string, artists: string[]): Promise<SoundCloudTrack[]> {
        try {
            const res = await fetch(`https://api-v2.soundcloud.com/search?q=${encodeURIComponent(name + " " + artists.join(" "))}&client_id=${USER_CLIENT_ID}`, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                },
            });

            if (!res.ok) return [];
            const data: SoundCloudCollectionResponse<SoundCloudTrack> = await res.json();
            if (Array.isArray(data.collection)) return data.collection;
            return [];
        } catch (err) {
            console.error(`SoundCloud alternative search error: ${err}`);
        }
        return [];
    }

    private weight = {
        title: 0.5,
        artist: 0.3,
        remixPenalty: -0.15,
        isrcBonus: 0.05,
    }
    private SCORE_THRESHOLD = 0.60;

    async matchByMetadata(name: string, artists: string[], duration_ms: Number, isrc?: string | null): Promise<TrackMatchResult | null> {
        void duration_ms; // keep parameter but don't use it in scoring

        // remove (feat. Artist) or similar from name
        name = name.replace(parenRegex, "").trim();
        artists = artists.slice(0, 1);
        const targetArtist = (artists[0] || "").toLowerCase().trim();

        const targetTitleTokens = tokenize(normalizeTitle(name));
        const weight = this.weight;

        // 1) alt search, no artist
        let results: SoundCloudTrack[] = await this.alternativeSearch(name, []);
        if (isrc) {
            const direct = pickUniqueIsrcMatch(results, isrc);
            if (direct) return direct;
        }
        let attempt = evaluateResults(results);
        if (attempt && attempt.best && attempt.bestScore >= this.SCORE_THRESHOLD) {
            return attempt.best;
        }

        // 2) alt serach w/ artist
        results = await this.alternativeSearch(name, artists);
        if (isrc) {
            const direct = pickUniqueIsrcMatch(results, isrc);
            if (direct) return direct;
        }
        attempt = evaluateResults(results);
        if (attempt && attempt.best && attempt.bestScore >= this.SCORE_THRESHOLD) {
            return attempt.best;
        }

        // 3) fallback to generic search (not best results)
        const q = `${name} ${artists.join(" ")}`.trim();
        if (artists[0] === "-") return null;
        results = await this.searchTracks(
            `linked_partitioning=1&limit=${SEARCH_LIMIT}&filter=public&q=${encodeURIComponent(q)}`
        );
        if (isrc) {
            const direct = pickUniqueIsrcMatch(results, isrc);
            if (direct) return direct;
        }
        attempt = evaluateResults(results);
        if (attempt && attempt.best && attempt.bestScore >= this.SCORE_THRESHOLD) {
            return attempt.best;
        }

        // If all three attempts fail to meet threshold, give up
        return null;

        function pickUniqueIsrcMatch(results: SoundCloudTrack[], isrc?: string): TrackMatchResult | null {
            if (!isrc || !results || results.length === 0) return null;

            const targetIsrc = isrc.trim().toUpperCase();
            const matches = results.filter(track => {
                const trackIsrc = track.isrc;
                if (!trackIsrc) return false;
                return trackIsrc.trim().toUpperCase() === targetIsrc;
            });

            if (matches.length === 1) {
                const track = matches[0];
                if (!track?.id) return null;

                const candidate: TrackMatchResult = {
                    providerTrackId: track.id.toString(),
                };
                if (track.title) candidate.name = track.title;
                if (track.user?.username) candidate.artists = [track.user.username];
                const trackIsrc = track.isrc?.trim();
                if (trackIsrc) candidate.isrc = trackIsrc;

                return candidate;
            }

            return null;
        }

        function evaluateResults(results: SoundCloudTrack[]): { best: TrackMatchResult | null; bestScore: number } | null {
            if (!results || results.length === 0) return null;

            let best: TrackMatchResult | null = null;
            let bestScore = 0;

            for (const track of results) {
                if (!track?.id) continue;

                const candidateTitle = track.title ?? "";
                const candidateArtist = (track.user?.username ?? "").toLowerCase().trim();

                const normCandidateTitle = normalizeTitle(candidateTitle);
                const candidateTitleTokens = tokenize(normCandidateTitle);

                // 1) Title similarity: token overlap Jaccard-ish score
                const titleScore = tokenOverlapScore(targetTitleTokens, candidateTitleTokens);

                // 2) Artist similarity: simple containment check, could be improved with aliases map
                let artistScore = 0;
                if (targetArtist && candidateArtist) {
                    if (candidateArtist.includes(targetArtist) || targetArtist.includes(candidateArtist)) {
                        artistScore = 1;
                    } else {
                        // partial overlap on words
                        const targetArtistTokens = tokenize(targetArtist);
                        const candidateArtistTokens = tokenize(candidateArtist);
                        artistScore = tokenOverlapScore(targetArtistTokens, candidateArtistTokens);
                    }
                }

                // 3) Penalize mismatched "remix/live/cover" if not in original title
                const penalty = remixPenalty(targetTitleTokens, candidateTitleTokens);

                // 4) Small positive weight if ISRC metadata is present
                const isrcBonus = track.isrc ? weight.isrcBonus : 0;
                // Weight the components: tweak as needed
                const totalScore =
                    weight.title * titleScore +
                    weight.artist * artistScore +
                    penalty +
                    isrcBonus;

                if (totalScore > bestScore) {
                    bestScore = totalScore;

                    const candidate: TrackMatchResult = {
                        providerTrackId: track.id.toString(),
                    };
                    if (track.title) candidate.name = track.title;
                    if (track.user?.username) candidate.artists = [track.user.username];
                    const isrc = track.isrc?.trim();
                    if (isrc) candidate.isrc = isrc;

                    best = candidate;
                }
            }

            return { best, bestScore };
        }

        function tokenize(text: string): string[] {
            if (!text) return [];
            return text
                .split(/\s+/)
                .map(t => t.trim())
                .filter(Boolean);
        }

        function normalizeTitle(title: string): string {
            return title
                .toLowerCase()
                .replace(featRegex, "")
                .replace(/[\[\]\(\)\-_,.]/g, " ")
                .replace(/\s+/g, " ")
                .trim();
        }

        function tokenOverlapScore(targetTokens: string[], candidateTokens: string[]): number {
            if (!targetTokens.length || !candidateTokens.length) return 0;

            const candidateSet = new Set(candidateTokens);
            let intersection = 0;

            for (const t of targetTokens) {
                if (candidateSet.has(t)) intersection++;
            }

            return intersection / targetTokens.length;
        }

        function remixPenalty(targetTokens: string[], candidateTokens: string[]): number {
            const flags = ["remix", "live", "cover", "karaoke", "edit"];
            const targetHas = flags.some(f => targetTokens.includes(f));
            const candidateHas = flags.some(f => candidateTokens.includes(f));

            if (candidateHas && !targetHas) {
                return -0.15;
            }
            return 0;
        }
    }





    async matchByMetadatas(tracks: TransferTrack[]): Promise<Map<string, TrackMatchResult>> {
        const matches = new Map<string, TrackMatchResult>();
        for (const track of tracks) {
            const match = await this.matchByMetadata(track.name, track.artists, track.durationMs || 0, track.isrc);
            if (match) {
                matches.set(track.id, match);
            }
        }
        return matches;
    }

    async ensurePlaylist(options: { playlistId?: string | null; name: string; description?: string | null; public?: boolean; image?: string | null }): Promise<PlaylistResolution> {
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
