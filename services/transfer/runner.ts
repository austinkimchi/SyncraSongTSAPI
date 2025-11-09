import { ObjectId } from "mongodb";
import { db } from "../../mongo.js";
import { state } from "../../types/general.js";
import type { TransferJobDoc } from "./types.js";
import type { UserDoc, OAuthEntry } from "../../types/database.js";
import { createTransferProvider } from "./providers/index.js";
import type { TransferProvider } from "./types.js";

interface ProgressMeta {
    phase: string;
    [key: string]: any;
}

function normalizeObjectId(id: any): ObjectId {
    if (!id) throw new Error('Job document is missing _id');
    return id instanceof ObjectId ? id : new ObjectId(id);
}

async function updateTransferJob(jobId: ObjectId, update: { status?: string; transferredTracks?: number | null; totalTracks?: number | null; meta?: ProgressMeta; }): Promise<void> {
    const updateDoc: Record<string, any> = {
        updatedAt: new Date(),
    };
    if (typeof update.status !== 'undefined') updateDoc.status = update.status;
    if (typeof update.transferredTracks !== 'undefined') updateDoc.transferredTracks = update.transferredTracks;
    if (typeof update.totalTracks !== 'undefined') updateDoc.totalTracks = update.totalTracks;
    if (typeof update.meta !== 'undefined') updateDoc.meta = update.meta;

    await db.collection('transferJobs').updateOne(
        { _id: jobId },
        { $set: updateDoc },
    );
}

function pickOAuth(user: UserDoc, provider: string): OAuthEntry {
    const entry = user.oauth?.find(o => o.provider === provider);
    if (!entry) throw new Error(`User does not have provider ${provider} connected`);
    return entry;
}

function ensureTargetPlaylistOptions(doc: TransferJobDoc): void {
    if (!doc.target.playlistId && doc.target.createIfMissing === false) {
        throw new Error('Target playlistId is required when createIfMissing is false');
    }
}

export async function runTransfer(doc: TransferJobDoc): Promise<void> {
    const jobId = normalizeObjectId(doc._id);
    const meta: ProgressMeta = { phase: 'initializing' };

    await updateTransferJob(jobId, {
        status: state.PROCESSING,
        transferredTracks: 0,
        totalTracks: null,
        meta,
    });

    try {
        ensureTargetPlaylistOptions(doc);

        const user = await db.collection<UserDoc>('users').findOne({ _id: doc.userId });
        if (!user) throw new Error('User not found');

        const sourceOAuth = pickOAuth(user, doc.source.provider);
        const targetOAuth = pickOAuth(user, doc.target.provider);

        const sourceProvider: TransferProvider = createTransferProvider(doc.source.provider, sourceOAuth);
        const targetProvider: TransferProvider = createTransferProvider(doc.target.provider, targetOAuth);
        console.info(`Starting transfer from ${doc.source.provider} to ${doc.target.provider} for user ${user._id.toString()}`);

        meta.phase = 'fetching-source-playlist';
        meta.source = { provider: doc.source.provider, playlistId: doc.source.playlistId };
        await updateTransferJob(jobId, { meta });

        const sourcePlaylist = await sourceProvider.getPlaylist(doc.source.playlistId);
        const totalTracks = sourcePlaylist.tracks.length;
        meta.source.playlistName = sourcePlaylist.name;
        meta.totalTracks = totalTracks;
        meta.phase = 'matching-tracks';
        await updateTransferJob(jobId, {
            totalTracks,
            meta,
        });

        const tracksWithIsrc = sourcePlaylist.tracks.filter(track => track.isrc && track.isrc.trim() !== '');
        const missingIsrc = sourcePlaylist.tracks
            .filter(track => !track.isrc || track.isrc.trim() === '')
            .map(track => ({ name: track.name, artists: track.artists }));

        const uniqueIsrcs = Array.from(new Set(tracksWithIsrc.map(track => track.isrc!.trim())));
        const matchesMap = doc.source.provider === 'soundcloud' ? await targetProvider.matchByMetadatas(sourcePlaylist.tracks) : await targetProvider.matchTracksByIsrc(uniqueIsrcs);

        const matchedProviderTrackIds: string[] = [];
        const unmatchedTracks: Array<{ name: string; artists: string[]; isrc: string }> = [];

        for (const track of tracksWithIsrc) {
            const isrc = track.isrc!.trim();
            const match = matchesMap.get(isrc);
            if (match) {
                matchedProviderTrackIds.push(match.providerTrackId);
            } else {
                unmatchedTracks.push({ name: track.name, artists: track.artists, isrc });
            }
        }
        if (unmatchedTracks.length > 0 && doc.source.provider !== 'soundcloud') {
            if (typeof targetProvider.matchByMetadata === 'function') {
                for (const trackInfo of unmatchedTracks.slice()) {
                    const track_index = sourcePlaylist.tracks.findIndex(t => t.isrc === trackInfo.isrc);
                    const track_duration = track_index ? (sourcePlaylist.tracks[track_index]!).durationMs || 0 : 0;
                    const match = await targetProvider.matchByMetadata(trackInfo.name, trackInfo.artists, track_duration);
                    if (match) {
                        // push at same index to preserve order
                        if (track_index !== -1) {
                            matchedProviderTrackIds.splice(track_index, 0, match.providerTrackId);
                        }
                        else matchedProviderTrackIds.push(match.providerTrackId);

                        // remove from unmatchedTracks
                        const index = unmatchedTracks.findIndex(t => t.isrc === trackInfo.isrc);
                        if (index !== -1) {
                            unmatchedTracks.splice(index, 1);
                        }
                    }
                }
            }
        }

        meta.phase = 'preparing-destination';
        meta.matching = {
            requested: uniqueIsrcs.length,
            matched: matchedProviderTrackIds.length,
            unmatched: unmatchedTracks.length,
            missingIsrc: missingIsrc.length,
        };
        meta.missingIsrc = missingIsrc;
        meta.unmatched = unmatchedTracks;
        await updateTransferJob(jobId, {
            meta,
        });

        const playlistName = doc.target.name ?? `${sourcePlaylist.name}`;
        const ensureOptions:
            {
                playlistId?: string | null;
                name: string;
                description?: string | null;
                public?: boolean
            } =
        {
            playlistId: doc.target.playlistId ?? null,
            name: playlistName,
            description: sourcePlaylist.description ?? null,
        };

        if (typeof sourcePlaylist.public === 'boolean')
            ensureOptions.public = sourcePlaylist.public || false;

        const playlistResolution = await targetProvider.ensurePlaylist(ensureOptions);

        meta.phase = 'adding-tracks';
        meta.target = {
            provider: doc.target.provider,
            playlistId: playlistResolution.playlistId,
            playlistName: playlistResolution.name,
            created: playlistResolution.created,
        };
        await updateTransferJob(jobId, {
            meta,
        });

        let transferred = 0;
        // spotify = 100, soundcloud = 200, apple music/others = 25
        let chunkSize = doc.target.provider === 'spotify' ? 100 : doc.target.provider === 'soundcloud' ? 200 : 25;
        for (let i = 0; i < matchedProviderTrackIds.length; i += chunkSize) {
            const chunk = matchedProviderTrackIds.slice(i, i + chunkSize);
            await targetProvider.addTracks(playlistResolution.playlistId, chunk);
            transferred += chunk.length;
            meta.added = transferred;
            await updateTransferJob(jobId, {
                transferredTracks: transferred,
                totalTracks,
                meta,
            });
        }
        console.info('Transfer complete');
        meta.phase = 'complete';
        meta.summary = {
            totalTracks,
            transferred,
            skippedMissingIsrc: missingIsrc.length,
            unmatched: unmatchedTracks.length,
            destinationPlaylistId: playlistResolution.playlistId,
        };
        await updateTransferJob(jobId, {
            transferredTracks: transferred,
            totalTracks,
            meta,
        });
    } catch (error: any) {
        meta.phase = 'error';
        meta.error = String(error?.message ?? error);
        await updateTransferJob(jobId, {
            status: state.ERROR,
            meta,
        });
        throw error;
    }
}
