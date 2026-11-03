import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationsConnectionSettings } from './integration/notifications-postgres-fixture.js';

test('la suite de notificaciones rechaza destinos compartidos antes de abrir conexiones', () => {
  const local = 'postgresql://notifications_test_admin:test_only@127.0.0.1:55434/ics_notifications_test';
  const enabled = { NOTIFICATIONS_ALLOW_INTEGRATION_WRITES: '1' };
  for (const url of [undefined, '', local.replace('127.0.0.1', 'db.neon.tech'), local.replace('55434', '5432'),
    local.replace('ics_notifications_test', 'production'), local.replace('notifications_test_admin', 'postgres'),
    `${local}?host=another-host`, `${local}#fragment`, ` ${local}`, local.replace('test_only', '%00')]) {
    assert.throws(() => notificationsConnectionSettings({ ...enabled, TEST_NOTIFICATIONS_DATABASE_URL: url }));
  }
  assert.throws(() => notificationsConnectionSettings({ TEST_NOTIFICATIONS_DATABASE_URL: local, DATABASE_URL: local }));
  assert.throws(() => notificationsConnectionSettings({ ...enabled, DATABASE_URL: local }));
  const settings = notificationsConnectionSettings({ ...enabled, TEST_NOTIFICATIONS_DATABASE_URL: local, PGHOST: 'ignored' });
  assert.equal(settings.host, '127.0.0.1');
  assert.equal(settings.database, 'ics_notifications_test');
});
