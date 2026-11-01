import { test } from 'node:test';
import { catalogDatabase } from './catalog-database.js';
import { turnsScenarios } from './turns-scenarios.js';

test('SCRUM-25: reservas, rechazos, reasignación y correo persistidos', async t => {
  const fixture = await catalogDatabase();
  try { await turnsScenarios(t, fixture.client); }
  finally { await fixture.close(); }
});
