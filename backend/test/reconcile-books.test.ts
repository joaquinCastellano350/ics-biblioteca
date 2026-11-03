import { test } from 'node:test';
import { catalogDatabase } from './catalog-database.js';
import { reconciliationScenarios } from './reconciliation-scenarios.js';

test('contrato compartido SCRUM-25/27: conciliación transaccional', async t => {
  const fixture = await catalogDatabase();
  try { await reconciliationScenarios(t, fixture.client); }
  finally { await fixture.close(); }
});
