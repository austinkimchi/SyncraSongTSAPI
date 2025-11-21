import type { OAuthEntry } from "../../../types/database.js";
import type { PlaylistResolution, SourcePlaylist, TrackMatchResult, TransferProvider, TransferTrack } from "../types.js";
import { getDeveloperToken } from "../../../routes/api/apple_music/getDeveloperToken.js";

const APPLE_API_BASE = "https://api.music.apple.com";
const LIBRARY_PLAYLISTS_ENDPOINT = `${APPLE_API_BASE}/v1/me/library/playlists`;
const ME_STOREFRONT_ENDPOINT = `${APPLE_API_BASE}/v1/me/storefront`;

interface ApplePlaylistResponse {
    data?: any[];
    next?: string;
}

async function doAppleFetch(url: string, options: RequestInit): Promise<any> {
    const res = await fetch(url, options);
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Apple Music API error ${res.status}: ${body}`);
    }

    if (res.status === 204) return null;
    return res.json();
}

export class AppleMusicTransferProvider implements TransferProvider {
    public readonly provider = 'apple_music' as const;
    private readonly oauth: OAuthEntry;
    private developerTokenPromise: Promise<string> | null = null;
    private cachedStorefront: string | null = null;

    constructor(oauth: OAuthEntry) {
        if (!oauth.accessToken) throw new Error('Apple Music OAuth entry missing access token');
        this.oauth = oauth;
    }

    private async getDeveloperToken(): Promise<string> {
        if (!this.developerTokenPromise) {
            this.developerTokenPromise = getDeveloperToken(60 * 5); // 5 minutes cache
        }
        return this.developerTokenPromise;
    }

    private async getStorefront(): Promise<string> {
        if (this.cachedStorefront) return this.cachedStorefront;
        const developerToken = await this.getDeveloperToken();
        const res = await doAppleFetch(ME_STOREFRONT_ENDPOINT, {
            headers: {
                Authorization: `Bearer ${developerToken}`,
                "Music-User-Token": this.oauth.accessToken,
            },
        });
        const storefront = res?.data?.[0]?.id ?? 'us';
        this.cachedStorefront = storefront;
        return storefront;
    }

    private async getCatalogTracksByIds(ids: string[]): Promise<Map<string, any>> {
        const storefront = await this.getStorefront();
        const developerToken = await this.getDeveloperToken();
        const catalogMap = new Map<string, any>();
        const chunkSize = 25;
        for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const url = `${APPLE_API_BASE}/v1/catalog/${storefront}/songs?ids=${chunk.map(encodeURIComponent).join(',')}`;
            const res = await doAppleFetch(url, {
                headers: {
                    Authorization: `Bearer ${developerToken}`,
                },
            });
            for (const item of res?.data ?? []) {
                if (item?.id) catalogMap.set(item.id, item);
            }
        }
        return catalogMap;
    }

    async getPlaylist(playlistId: string): Promise<SourcePlaylist> {
        const developerToken = await this.getDeveloperToken();
        const headers: Record<string, string> = {
            Authorization: `Bearer ${developerToken}`,
            "Music-User-Token": this.oauth.accessToken,
        };

        const playlistUrl = `${LIBRARY_PLAYLISTS_ENDPOINT}/${encodeURIComponent(playlistId)}?include=tracks`;
        const playlistResponse = await doAppleFetch(playlistUrl, { headers });
        const playlist = playlistResponse?.data?.[0];
        if (!playlist) throw new Error('Apple Music playlist not found');

        const playlistName = playlist?.attributes?.name ?? 'Untitled Playlist';
        const playlistDescription = playlist?.attributes?.description?.standard ?? null;
        const playlistPublic = playlist?.attributes?.isPublic ?? undefined;

        const tracks: TransferTrack[] = [];
        let trackData = playlist?.relationships?.tracks;
        let trackItems: any[] = Array.isArray(trackData?.data) ? trackData.data : [];
        let nextTrackUrl: string | null = trackData?.next ? new URL(trackData.next, APPLE_API_BASE).toString() : null;

        const catalogIds: (string | null)[] = [];

        const pushTrack = (item: any) => {
            const id = item?.id ?? '';
            const attributes = item?.attributes ?? {};
            const name = attributes?.name ?? '';
            const artists = Array.isArray(attributes?.artistName)
                ? attributes.artistName
                : attributes?.artistName
                    ? [attributes.artistName]
                    : [];
            const playParams = attributes?.playParams ?? {};
            const catalogId = playParams?.catalogId ?? null;
            catalogIds.push(catalogId);
            tracks.push({
                id,
                name,
                artists,
                album: attributes?.albumName,
                isrc: attributes?.isrc ?? null,
                durationMs: attributes?.durationInMillis,
                raw: item,
            });
        };

        for (const item of trackItems) pushTrack(item);

        while (nextTrackUrl) {
            const page = await doAppleFetch(nextTrackUrl, { headers }) as ApplePlaylistResponse;
            for (const item of page?.data ?? []) pushTrack(item);
            nextTrackUrl = page?.next ? new URL(page.next, APPLE_API_BASE).toString() : null;
        }

        // Resolve ISRCs using catalog IDs if needed
        const missingCatalogIds = catalogIds
            .map((catalogId, index) => ({ catalogId, index }))
            .filter(({ catalogId, index }) => {
                if (!catalogId) return false;
                const track = tracks[index];
                return !!track && (!track.isrc || track.isrc.trim() === '');
            });

        if (missingCatalogIds.length > 0) {
            const uniqueCatalogIds = Array.from(new Set(missingCatalogIds.map(item => item.catalogId as string)));
            const catalogMap = await this.getCatalogTracksByIds(uniqueCatalogIds);
            missingCatalogIds.forEach(({ catalogId, index }) => {
                if (!catalogId) return;
                const catalogTrack = catalogMap.get(catalogId);
                const catalogIsrc = catalogTrack?.attributes?.isrc ?? null;
                if (catalogIsrc && tracks[index]) {
                    tracks[index]!.isrc = catalogIsrc;
                }
            });
        }

        return {
            id: playlist?.id ?? playlistId,
            name: playlistName,
            description: playlistDescription,
            public: playlistPublic,
            tracks,
        };
    }

    async matchTracksByUPC(upcs: string[]): Promise<Map<string, TrackMatchResult>> {
        const developerToken = await this.getDeveloperToken();
        const storefront = await this.getStorefront();
        const matches = new Map<string, TrackMatchResult>();
        for (const upc of upcs) {
            const trimmed = upc.trim();
            if (!trimmed) continue;

            const url = `${APPLE_API_BASE}/v1/catalog/${storefront}/songs?filter[upc]=${encodeURIComponent(trimmed)}`;
            const res = await doAppleFetch(url, {
                headers: {
                    Authorization: `Bearer ${developerToken}`,
                },
            });
            const track = res?.data?.[0];
            if (track?.id) {
                matches.set(trimmed, {
                    isrc: trimmed,
                    providerTrackId: track.id,
                    name: track?.attributes?.name,
                    artists: track?.attributes?.artistName ? [track.attributes.artistName] : [],
                });
            }
        }
        return matches;
    }
    private scoreIsrcCandidate(song: any, album: any | undefined): number {
        const songAttrs = song?.attributes ?? {};
        const albumAttrs = album?.attributes ?? {};

        const trackName = (songAttrs.name ?? "").toLowerCase();
        const trackArtist = (songAttrs.artistName ?? "").toLowerCase();
        const albumName = (albumAttrs.name ?? "").toLowerCase();
        const albumArtist = (albumAttrs.artistName ?? "").toLowerCase();

        let score = 0;

        // Hard penalties for compilations / "Various Artists"
        if (albumAttrs.isCompilation) score -= 1000;
        if (albumArtist === "various artists") score -= 800;
        if (trackArtist === "various artists") score -= 400;

        // Prefer albums where album artist matches track artist
        if (albumArtist && trackArtist) {
            if (albumArtist === trackArtist) {
                score += 400;
            } else if (albumArtist.includes(trackArtist) || trackArtist.includes(albumArtist)) {
                score += 200;
            }
        }

        // Prefer albums whose title contains the track title
        // e.g. "Runaway (U & I) - Single"
        if (trackName && albumName && albumName.includes(trackName)) {
            score += 150;
        }

        // Mild preference for dedicated singles over mixed releases when all else is equal
        if (albumAttrs.isSingle) {
            score += 50;
        }

        // Prefer non-remix/non-live originals unless the track itself is clearly a remix
        const remixLike = /(remix|mix|live|karaoke|instrumental|version)/i;
        const trackIsRemix = remixLike.test(trackName);
        const albumIsRemix = remixLike.test(albumName);
        if (!trackIsRemix && albumIsRemix) {
            score -= 100;
        }

        // Prefer earlier releases (more likely to be the "original" album/single)
        const releaseDateStr: string | undefined =
            albumAttrs.releaseDate || songAttrs.releaseDate;
        if (releaseDateStr && /^\d{4}-\d{2}-\d{2}$/.test(releaseDateStr)) {
            const year = Number(releaseDateStr.slice(0, 4));
            if (!Number.isNaN(year)) {
                // Older year => higher score
                score += 2100 - year;
            }
        }

        // Small bump for non-single albums that look like normal releases
        if (albumAttrs.isComplete && albumAttrs.trackCount && albumAttrs.trackCount > 1) {
            score += 10;
        }

        return score;
    }

    async matchTracksByIsrc(isrcs: string[]): Promise<Map<string, TrackMatchResult>> {
        const developerToken = await this.getDeveloperToken();
        const storefront = await this.getStorefront();
        const matches = new Map<string, TrackMatchResult>();

        for (const isrc of isrcs) {
            const trimmed = isrc.trim();
            if (!trimmed) continue;

            // 1. Fetch all songs for this ISRC
            const url =
                `${APPLE_API_BASE}/v1/catalog/${storefront}/songs` +
                `?filter[isrc]=${encodeURIComponent(trimmed)}` +
                `&include=artists,albums&limit=25`;

            const res = await doAppleFetch(url, {
                headers: { Authorization: `Bearer ${developerToken}` },
            });

            const candidates: any[] = res?.data ?? [];
            if (!candidates.length) continue;

            // Defensive: ensure attributes.isrc really matches (in case filter is loose)
            const strictIsrcMatches = candidates.filter(
                (s: any) =>
                    (s.attributes?.isrc ?? "").toUpperCase() === trimmed.toUpperCase()
            );
            const effectiveCandidates = strictIsrcMatches.length
                ? strictIsrcMatches
                : candidates;

            if (!effectiveCandidates.length) continue;

            // 2. Preload album metadata for all referenced albums
            const albumIds = Array.from(
                new Set(
                    effectiveCandidates.flatMap(
                        (s: any) =>
                            s.relationships?.albums?.data?.map((a: any) => a.id) ?? []
                    )
                )
            );

            const albumsById = new Map<string, any>();
            for (let i = 0; i < albumIds.length; i += 25) {
                const chunk = albumIds.slice(i, i + 25);
                if (!chunk.length) continue;

                const albumUrl =
                    `${APPLE_API_BASE}/v1/catalog/${storefront}/albums` +
                    `?ids=${chunk.map(id => encodeURIComponent(id)).join(",")}`;

                const albumRes = await doAppleFetch(albumUrl, {
                    headers: { Authorization: `Bearer ${developerToken}` },
                });

                for (const album of albumRes?.data ?? []) {
                    if (album?.id) {
                        albumsById.set(album.id, album);
                    }
                }
            }

            // 3. Score all candidates and pick the best non-compilation artist album
            let best: any | null = null;
            let bestScore = -Infinity;

            for (const song of effectiveCandidates) {
                const albumId: string | undefined =
                    song.relationships?.albums?.data?.[0]?.id;
                const album = albumId ? albumsById.get(albumId) : undefined;
                const score = this.scoreIsrcCandidate(song, album);

                if (score > bestScore) {
                    bestScore = score;
                    best = song;
                }
            }

            if (!best?.id) continue;

            matches.set(trimmed, {
                isrc: trimmed,
                providerTrackId: best.id,
                name: best.attributes?.name,
                artists: best.attributes?.artistName
                    ? [best.attributes.artistName]
                    : [],
            });
        }

        return matches;
    }


    async matchByMetadata(name: string, artists: string[], duration_ms: Number): Promise<TrackMatchResult | null> {
        const developerToken = await this.getDeveloperToken();
        const storefront = await this.getStorefront();
        const query = `${name} ${artists.join(' ')}`.trim();
        const url = `${APPLE_API_BASE}/v1/catalog/${storefront}/search?term=${encodeURIComponent(query)}&types=songs&limit=5`;
        const res = await doAppleFetch(url, {
            headers: { Authorization: `Bearer ${developerToken}` },
        });
        const candidates = res?.results?.songs?.data ?? [];
        let bestMatch: any = null;
        let smallestDurationDiff = Number.MAX_SAFE_INTEGER;

        for (const candidate of candidates) {
            const candidateDuration = candidate.attributes?.durationInMillis ?? 0;
            const durationDiff = Math.abs(candidateDuration - Number(duration_ms));
            if (durationDiff < smallestDurationDiff) {
                smallestDurationDiff = durationDiff;
                bestMatch = candidate;
            }
        }

        if (bestMatch?.id) {
            return {
                providerTrackId: bestMatch.id,
                name: bestMatch.attributes?.name,
                artists: bestMatch.attributes?.artistName ? [bestMatch.attributes.artistName] : [],
            };
        }
        return null;
    }

    async matchByMetadatas(tracks: TransferTrack[]): Promise<Map<string, TrackMatchResult>> {
        const matches = new Map<string, TrackMatchResult>();
        for (const track of tracks) {
            const match = await this.matchByMetadata(track.name, track.artists, track.durationMs || 0);
            if (match) {
                matches.set(track.isrc || track.id, match);
            }
        }
        return matches;
    }

    async ensurePlaylist(options: { playlistId?: string | null; name: string; description?: string | null; public?: boolean; }): Promise<PlaylistResolution> {
        if (options.playlistId) {
            // ensure playlist exists
            await this.getPlaylist(options.playlistId);
            return {
                playlistId: options.playlistId,
                name: options.name,
                created: false,
            };
        }

        const developerToken = await this.getDeveloperToken();
        const headers: Record<string, string> = {
            Authorization: `Bearer ${developerToken}`,
            "Music-User-Token": this.oauth.accessToken,
            "Content-Type": "application/json",
        };

        const body = {
            attributes: {
                name: options.name,
                description: options.description ?? undefined,
            },
        };

        const res = await doAppleFetch(LIBRARY_PLAYLISTS_ENDPOINT, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        const playlistId = res?.data?.[0]?.id;
        if (!playlistId) throw new Error('Failed to create Apple Music playlist');

        return {
            playlistId,
            name: options.name,
            created: true,
        };
    }

    async addTracks(playlistId: string, providerTrackIds: string[]): Promise<void> {
        if (providerTrackIds.length === 0) return;
        const developerToken = await this.getDeveloperToken();
        const headers: Record<string, string> = {
            Authorization: `Bearer ${developerToken}`,
            "Music-User-Token": this.oauth.accessToken,
            "Content-Type": "application/json",
        };
        const chunkSize = 25;
        for (let i = 0; i < providerTrackIds.length; i += chunkSize) {
            const chunk = providerTrackIds.slice(i, i + chunkSize);
            const body = {
                data: chunk.map(id => ({ id, type: 'songs' })),
            };
            const url = `${LIBRARY_PLAYLISTS_ENDPOINT}/${encodeURIComponent(playlistId)}/tracks`;
            await doAppleFetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });
        }
    }
}
