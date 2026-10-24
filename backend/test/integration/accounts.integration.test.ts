import { accountsScenarios } from '../accounts-scenarios.js';
import { openPostgresFixture } from './postgres-fixture.js';

accountsScenarios('cuentas con PostgreSQL local aislado', openPostgresFixture);
