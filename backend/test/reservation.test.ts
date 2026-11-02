import { test } from 'node:test';
import { catalogDatabase } from './catalog-database.js';
import { reservationScenarios } from './reservation-scenarios.js';

test('SCRUM-26: aceptación de reservas y resultados persistidos', async t => {
  const fixture = await catalogDatabase();
  try { await reservationScenarios(t, fixture.client); }
  finally { await fixture.close(); }
});
