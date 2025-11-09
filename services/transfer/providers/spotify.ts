import SpotifyWebApi from "spotify-web-api-node";
import type { OAuthEntry } from "../../../types/database.js";
import type { TransferProvider, SourcePlaylist, TransferTrack, PlaylistResolution, TrackMatchResult } from "../types.js";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Spotify environment variables are not configured');
}

const PLAYLIST_TRACK_FETCH_LIMIT = 100;
const ADD_TRACK_CHUNK_SIZE = 100;

function buildSpotifyClient(accessToken: string): SpotifyWebApi {
    const api = new SpotifyWebApi({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
    });
    api.setAccessToken(accessToken);
    return api;
}

export class SpotifyTransferProvider implements TransferProvider {
    public readonly provider = 'spotify' as const;

    private readonly oauth: OAuthEntry;
    private readonly api: SpotifyWebApi;

    constructor(oauth: OAuthEntry) {
        if (!oauth.accessToken) throw new Error('Spotify OAuth entry missing access token');
        this.oauth = oauth;
        this.api = buildSpotifyClient(oauth.accessToken);
    }

    async getPlaylist(playlistId: string): Promise<SourcePlaylist> {
        const playlist = await this.api.getPlaylist(playlistId);
        const totalTracks = playlist.body.tracks.total ?? 0;
        const tracks: TransferTrack[] = [];
        let offset = 0;

        while (offset < totalTracks) {
            const response = await this.api.getPlaylistTracks(playlistId, {
                limit: PLAYLIST_TRACK_FETCH_LIMIT,
                offset,
            });
            for (const item of response.body.items || []) {
                const track = item.track as SpotifyApi.TrackObjectFull | null;
                if (!track) continue;
                tracks.push({
                    id: track.uri ?? track.id ?? '',
                    name: track.name,
                    artists: track.artists?.map(a => a.name) ?? [],
                    album: track.album?.name,
                    isrc: track.external_ids?.isrc ?? null,
                    upc: track.external_ids?.upc ?? null,
                    durationMs: track.duration_ms ?? undefined,
                    raw: track,
                });
            }
            offset += response.body.items?.length ?? 0;
        }

        const result: SourcePlaylist = {
            id: playlist.body.id ?? playlistId,
            name: playlist.body.name ?? 'Untitled Playlist',
            description: playlist.body.description ?? null,
            tracks,
        };
        if (typeof playlist.body.public === 'boolean') {
            result.public = playlist.body.public;
        }
        return result;
    }

    async matchTracksByUPC(upcs: string[]): Promise<Map<string, TrackMatchResult>> {
        const matches = new Map<string, TrackMatchResult>();
        for (const upc of upcs) {
            const trimmed = upc.trim();
            if (!trimmed) continue;
            const res = await this.api.searchTracks(`upc:${trimmed}`, { limit: 1 });
            const track = res.body.tracks?.items?.[0];
            if (track?.uri) {
                matches.set(trimmed, {
                    isrc: trimmed,
                    providerTrackId: track.uri,
                    name: track.name,
                    artists: track.artists?.map(a => a.name) ?? [],
                });
            }
        }
        return matches;
    }

    async matchTracksByIsrc(isrcs: string[]): Promise<Map<string, TrackMatchResult>> {
        const matches = new Map<string, TrackMatchResult>();

        for (const isrc of isrcs) {
            const trimmed = isrc.trim();
            if (!trimmed) continue;

            const res = await this.api.searchTracks(`isrc:${trimmed}`, { limit: 5 });
            const items = res.body.tracks?.items ?? [];

            // Filter out tracks not from the main artist's album
            const validTrack = items.find(t => {
                const albumTypeOk = t.album.album_type === "album" || t.album.album_type === "single";
                const sameArtist =
                    t.artists.length > 0 &&
                    t.album.artists.some(a => t.artists.some(b => a.id === b.id));
                return albumTypeOk && sameArtist;
            });

            if (validTrack?.uri) {
                matches.set(trimmed, {
                    isrc: trimmed,
                    providerTrackId: validTrack.uri,
                    name: validTrack.name,
                    artists: validTrack.artists?.map(a => a.name) ?? [],
                });
            }
        }

        return matches;
    }


    async matchByMetadata(name: string, artists: string[], duration_ms: Number): Promise<TrackMatchResult | null> {
        const query = `track:${name} artist:${artists.join(' ')}`;
        const res = await this.api.searchTracks(query, { limit: 5 });
        if (!res.body.tracks?.items || res.body.tracks.items.length === 0) return null;
        const items = res.body.tracks?.items;
        if (duration_ms === 0) {
            const track = items[0];
            if (!track) return null;
            return {
                isrc: track.external_ids?.isrc ?? '',
                providerTrackId: track.uri ?? '',
                name: track.name,
                artists: track.artists?.map(a => a.name) ?? [],
            };
        }

        let closestMatch: TrackMatchResult | null = null;
        let smallestDurationDiff = Number.MAX_SAFE_INTEGER;
        const DEVIATION = 1500; // 1.5 second deviation allowed
        for (const track of res.body.tracks.items ?? []) {
            const trackDuration = track.duration_ms ?? 0;
            const durationDiff = Math.abs(trackDuration - Number(duration_ms));
            if (durationDiff === DEVIATION) break;
            if (durationDiff < smallestDurationDiff) {
                smallestDurationDiff = durationDiff;
                closestMatch = {
                    isrc: track.external_ids?.isrc ?? '',
                    providerTrackId: track.uri ?? '',
                    name: track.name,
                    artists: track.artists?.map(a => a.name) ?? [],
                };
            }
        }
        return closestMatch;
    }

    async matchByMetadatas(tracks: TransferTrack[]): Promise<Map<string, TrackMatchResult>> {
        const matches = new Map<string, TrackMatchResult>();
        for (const track of tracks) {
            if (!track.name || !track.artists || track.artists.length === 0) continue;
            const match = await this.matchByMetadata(track.name, track.artists, track.durationMs || 0);
            if (match) {
                matches.set(track.isrc || track.name + track.artists.join(','), match);
            }
        }
        return matches;
    }

    async ensurePlaylist(options: { playlistId?: string | null; name: string; description?: string | null; public?: boolean; }): Promise<PlaylistResolution> {
        if (options.playlistId) {
            const existing = await this.api.getPlaylist(options.playlistId);
            return {
                playlistId: existing.body.id ?? options.playlistId,
                name: existing.body.name ?? options.name,
                created: false,
            };
        }

        const created = await this.api.createPlaylist(options.name, {
            public: options.public ?? false,
            description: options.description ?? undefined,
        });

        return {
            playlistId: created.body.id ?? '',
            name: created.body.name ?? options.name,
            created: true,
        };
    }

    async addTracks(playlistId: string, providerTrackIds: string[]): Promise<void> {
        for (let i = 0; i < providerTrackIds.length; i += ADD_TRACK_CHUNK_SIZE) {
            const chunk = providerTrackIds.slice(i, i + ADD_TRACK_CHUNK_SIZE);
            if (chunk.length === 0) continue;
            await this.api.addTracksToPlaylist(playlistId, chunk);
        }
    }
}
