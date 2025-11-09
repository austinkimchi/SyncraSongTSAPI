import { ObjectId } from 'mongodb';
import { db } from '../mongo.js';
import { state } from '../types/general.js';
import { getAgenda } from './index.js';
import { JobNames } from './jobNames.js';

const COLLECTION = 'transferJobs';

export async function ensureTransferIndexes() {
    const col = db.collection(COLLECTION);
    await col.createIndex({ status: 1, runAt: 1, createdAt: 1 });
    await col.createIndex({ userId: 1, createdAt: 1 });
}

export async function createTransferDoc(payload: any): Promise<string> {
    const now = new Date();
    const { insertedId } = await db.collection(COLLECTION).insertOne({
        ...payload,
        status: state.QUEUED,
        attempts: 0,
        runAt: payload?.runAt || now,
        createdAt: now,
        updatedAt: now,
    });

    const agenda = await getAgenda();
    if (!agenda) throw new Error('Agenda not initialized');
    await agenda.now(JobNames.TransferPlaylist, { jobId: insertedId.toString() });

    return insertedId.toString();
}

export async function getTransferDoc(id: string) {
    return db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
}

export async function markJobSucceeded(id: string) {
    await db.collection(COLLECTION).updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'succeeded', updatedAt: new Date() } }
    );
}

export async function markJobFailed(id: string, error: string) {
    await db.collection(COLLECTION).updateOne(
        { _id: new ObjectId(id) },
        { $inc: { attempts: 1 }, $set: { status: 'failed', lastError: error, updatedAt: new Date() } }
    );
}

export async function requeueStaleRunning(staleMs: number) {
    const cutoff = new Date(Date.now() - staleMs);
    await db.collection(COLLECTION).updateMany(
        { status: 'running', updatedAt: { $lt: cutoff } },
        { $set: { status: 'queued', updatedAt: new Date() } }
    );
}

export async function pruneOld(days: number) {
    const cutoff = new Date(Date.now() - days * 86400000);
    await db.collection(COLLECTION).deleteMany({
        status: { $in: ['succeeded', 'failed', 'canceled'] },
        updatedAt: { $lt: cutoff },
    });
}
