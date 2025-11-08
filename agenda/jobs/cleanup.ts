import type { Agenda } from 'agenda';
import { JobNames } from '../jobNames.js';
import { requeueStaleRunning, pruneOld } from '../../agenda/transferJobs.js';

export function defineCleanup(agenda: Agenda) {
  agenda.define(JobNames.Cleanup, async () => {
    await requeueStaleRunning(5 * 60 * 1000); // 5 min stale
    await pruneOld(30);                       // keep 30 days
  });
}
