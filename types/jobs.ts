import type { Provider } from './general';

export interface TransferPlaylistData {
  jobId: string;               // _id in transfer_jobs collection
  userId: string;
  source: { provider: Provider; playlistId: string };
  // for future syncing 
  target: { provider: Provider; playlistId?: string; createIfMissing?: boolean };
}
