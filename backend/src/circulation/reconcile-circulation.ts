import { database } from '../database.js';
import { CirculationWorker } from './circulation-worker.js';

try {
  await new CirculationWorker(database).runBatch();
} catch {
  console.error('No se pudo completar la conciliación; el trabajo pendiente se conserva en la base.');
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
