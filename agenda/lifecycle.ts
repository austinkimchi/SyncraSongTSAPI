import { getAgenda } from './index.js';
import { JobNames } from './jobNames.js';

export async function startAgenda() {
  const agenda = await getAgenda();
  await agenda.start();
  await agenda.every('5 minutes', JobNames.Cleanup);
}

export async function stopAgenda() {
  const agenda = await getAgenda();
  await agenda.stop();
}
