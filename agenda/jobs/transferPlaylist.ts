import type { Agenda, Job } from 'agenda';
import { JobNames } from '../jobNames.js';
import type { TransferPlaylistData } from '../../types/jobs.js';
import { runTransfer } from '../../services/transfer/runner.js';
import { getTransferDoc, markJobFailed, markJobSucceeded } from '../../agenda/transferJobs.js';
import { state } from '../../types/general.js';

export function defineTransferPlaylist(agenda: Agenda) {
    agenda.define(JobNames.TransferPlaylist, { concurrency: 5 }, async (job: Job<TransferPlaylistData>) => {
        const data = job.attrs.data!;
        try {
            const doc = await getTransferDoc(data.jobId);
            if (!doc || doc.status === state.SUCCESS || doc.status === state.PROCESSING) return;
            console.log(`Starting transfer job ${data.jobId}`);
            await runTransfer(doc);                  // your provider logic
            await markJobSucceeded(data.jobId);
        } catch (err: any) {
            await markJobFailed(data.jobId, String(err?.message ?? err));
            throw err; // let Agenda retry based on your schedule strategy
        }
    });
}
