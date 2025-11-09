import Agenda from 'agenda';
import { registerJobs } from './registerJobs.js';

if (!process.env.MongoURI)
    throw new Error('MongoURI not defined in environment variables');

let agenda: Agenda | null = null;

export async function getAgenda(): Promise<Agenda> {
    if (agenda) return agenda;

    agenda = await new Agenda({
        db: { collection: 'agendaJobs', address: process.env.MongoURI as string },
        processEvery: '1 second',
        defaultConcurrency: 1,
        maxConcurrency: 2,
        defaultLockLifetime: 5 * 60 * 1000,
    });
    registerJobs(agenda);
    return agenda;
}
