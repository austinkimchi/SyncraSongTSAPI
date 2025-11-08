import type { Agenda } from 'agenda';
import { defineTransferPlaylist } from './jobs/transferPlaylist.js';
import { defineCleanup } from './jobs/cleanup.js';

export function registerJobs(agenda: Agenda) {
  defineTransferPlaylist(agenda);
  defineCleanup(agenda); // optional but recommended
}
