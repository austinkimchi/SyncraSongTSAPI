import { API_router, getUserId } from './api.js';
import { getAgenda } from '../../agenda/index.js';
import { JobNames } from '../../agenda/jobNames.js';
import { db } from './api.js';
import { createTransferDoc, getTransferDoc } from '../../agenda/transferJobs.js';
import { ObjectId } from 'mongodb';

/**
 * Initiate a playlist transfer
 */
API_router.post('/transfer', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    // validate req.body is array
    if (!Array.isArray(req.body))
        return res.status(400).json({ error: 'invalid request body' });

    // body will contain an array of {srcPlaylistID, srcPlatform, destPlatform}
    const ids = [];
    const failed_ids: string[] = [];

    for (const item of req.body) {
        if (!item.srcPlaylistID || !item.srcPlatform || !item.destPlatform) {
            failed_ids.push(item.srcPlaylistID || '');
            return res.status(400).json({ error: 'invalid playlist transfer item' });
        }
        const id = await createTransferDoc({
            userId,
            source: { provider: item.srcPlatform, playlistId: item.srcPlaylistID },
            target: { provider: item.destPlatform },
            options: item.options || {},
        });
        ids.push(id);
    }

    const agenda = await getAgenda();

    for (const id of ids) {
        const job = await agenda.now(JobNames.TransferPlaylist, { jobId: id });
        await db.collection('transferJobs').updateOne(
            { _id: new ObjectId(id) },
            { $set: { agendaJobId: job.attrs._id } }
        );
    }
    res.status(202).json({ ids, failed_ids, status: 'queued' });
});

/**
 * Get transfer status
 */
API_router.get('/transfer/:id', async (req, res) => {
    const doc = await getTransferDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json({
        id: doc._id,
        status: doc.status,
        progress: {
            transferredTracks: doc.transferredTracks ?? 0,
            totalTracks: doc.totalTracks ?? null,
            phase: doc.meta?.phase ?? null,
        },
        lastError: doc.lastError ?? null,
        updatedAt: doc.updatedAt,
    });
});
