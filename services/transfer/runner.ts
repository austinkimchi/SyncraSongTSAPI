import { db } from "../../mongo.js";

/**
 * Implement your provider logic here (Spotify/Apple).
 * Update progress frequently so the UI can poll.
 */
export async function runTransfer(doc: any) {
    let transferred = 0;
    const total = doc.totalTracks ?? null;

    // …fetch source tracks, ensure target playlist, add in batches…
    // after each batch:
    console.log(`Transferred ${transferred} of ${total} tracks`);
    transferred += 100; // example
    await db.collection('transfer').updateOne(
        { _id: doc._id },
        { $set: { transferredTracks: transferred, totalTracks: total, updatedAt: new Date(), meta: { phase: 'adding' } } }
    );
}

function parseJobData(jobID: string) {

}