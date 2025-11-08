import { startAgenda, stopAgenda } from './agenda/lifecycle.js';
import { ensureTransferIndexes } from './agenda/transferJobs.js';
import { startDatabase } from './mongo.js';

(async () => {
    startDatabase().then(async () => {
        await ensureTransferIndexes();
        await startAgenda();

        const shutdown = async () => { await stopAgenda(); process.exit(0); };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    });
})();
