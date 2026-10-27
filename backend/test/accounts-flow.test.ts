import { catalogDatabase } from './catalog-database.js';
import { accountsScenarios } from './accounts-scenarios.js';
import { universities } from '../prisma/universities.js';

accountsScenarios('registro y login juntos con Prisma y PostgreSQL en memoria', async () => {
  const fixture = await catalogDatabase();
  const database = fixture.client;
  await database.university.createMany({ data: universities });
  return {
    database,
    query: <T>(sql: string, values: unknown[] = []) => database.$queryRawUnsafe<T[]>(sql, ...values),
    async reset() { await database.session.deleteMany(); await database.user.deleteMany(); },
    close: () => fixture.close(),
    async installSessionFailure() {
      await database.$executeRawUnsafe(`CREATE FUNCTION test_fail_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo inducido'; END; $$`);
      await database.$executeRawUnsafe('CREATE TRIGGER test_fail_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION test_fail_session()');
    },
    async removeSessionFailure() {
      await database.$executeRawUnsafe('DROP TRIGGER test_fail_session ON sessions');
      await database.$executeRawUnsafe('DROP FUNCTION test_fail_session()');
    },
  };
});
