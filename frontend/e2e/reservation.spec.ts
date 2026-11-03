import { expect, test } from '@playwright/test';

const id = '11111111-1111-4111-8111-111111111111';

for (const entry of ['correo', 'Mis préstamos'] as const) {
  test(`SCRUM-26: aceptar desde ${entry}, actualizar y repetir sin duplicar`, async ({ page }, testInfo) => {
    const now = new Date();
    const session = { user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.org', university: { id: 'uni', name: 'Universidad' } },
      session: { createdAt: now.toISOString(), expiresAt: new Date(+now + 6 * 3_600_000).toISOString() }, serverTime: now.toISOString() };
    const loan = { id: '22222222-2222-4222-8222-222222222222', bookId: 'book', startedAt: now.toISOString(), dueAt: new Date(+now + 480 * 3_600_000).toISOString() };
    let authenticated = entry !== 'correo'; let granted = false; let attempts = 0; let created = 0;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/session') return route.fulfill({ status: authenticated ? 200 : 401,
        json: authenticated ? session : { error: { code: 'AUTH_REQUIRED' } } });
      if (path === '/api/auth/login') { authenticated = true; return route.fulfill({ json: session }); }
      if (path === '/api/me/circulation') return route.fulfill({ json: { serverTime: new Date().toISOString(),
        loans: granted ? [{ id: loan.id, book: { id: 'book', title: 'Libro reservado' }, startedAt: loan.startedAt, dueAt: loan.dueAt }] : [], waits: [],
        reservations: granted ? [] : [{ id, queueEntryId: 'queue', book: { id: 'book', title: 'Libro reservado' }, offeredAt: now.toISOString(), expiresAt: new Date(+now + 24 * 3_600_000).toISOString() }],
        requestConstraints: { activeLoanCount: granted ? 1 : 0, maxActiveLoans: 5, openQueueBookIds: granted ? [] : ['book'] },
      } });
      if (path === `/api/reservations/${id}/accept`) {
        expect(route.request().method()).toBe('POST'); expect(route.request().headers()['x-biblioteca-request']).toBe('1');
        attempts++; const fresh = !granted; if (fresh) created++;
        granted = true; return route.fulfill({ status: fresh ? 201 : 200, json: { loan, created: fresh, active: true } });
      }
      throw new Error(`API inesperada: ${path}`);
    });
    await page.goto(entry === 'correo' ? `/turno/${id}` : '/prestamos');
    if (entry === 'correo') {
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); expect(attempts).toBe(0);
      await dialog.getByLabel('Correo electrónico').fill('ana@example.org');
      await dialog.getByLabel('Contraseña', { exact: true }).fill('fixture-password');
      await dialog.getByRole('button', { name: 'Ingresar', exact: true }).click();
      await expect(page.getByText('¡Tu préstamo está confirmado!', { exact: false })).toBeVisible();
    } else {
      await expect(page.locator('.reserve-row').getByRole('button', { name: 'Aceptar préstamo', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('reserva-pendiente.png'), fullPage: true });
      await page.locator('.reserve-row').getByRole('button', { name: 'Aceptar préstamo', exact: true }).click();
      await expect(page.locator('.reserve-row')).toHaveCount(0);
      await expect(page.getByText('Tu préstamo está confirmado.', { exact: false })).toBeVisible();
    }
    expect(attempts).toBe(1); expect(created).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('reserva-aceptada.png'), fullPage: true });
    await page.goto(`/turno/${id}`);
    await expect(page.getByText('Este enlace ya fue utilizado.', { exact: false })).toBeVisible();
    expect(created).toBe(1); expect(attempts).toBe(2);
    await page.goto('/prestamos');
    await expect(page.locator('.loan-card')).toHaveCount(1);
    await expect(page.locator('.loan-card app-read-book-button')).toBeVisible();
  });
}

test('SCRUM-26: el rechazo por límite conserva su motivo en Mis préstamos', async ({ page }) => {
  const now = new Date(); const at = now.toISOString(); let rejected = false;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: { user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.org', university: { id: 'uni', name: 'Universidad' } },
      session: { createdAt: at, expiresAt: new Date(+now + 6 * 3_600_000).toISOString() }, serverTime: at } });
    if (path === '/api/me/circulation') return route.fulfill({ json: { serverTime: at, loans: [], waits: [],
      reservations: rejected ? [] : [{ id, queueEntryId: 'q', book: { id: 'book', title: 'Reserva por aceptar' }, offeredAt: at, expiresAt: new Date(+now + 24 * 3_600_000).toISOString() }],
      requestConstraints: { activeLoanCount: 5, maxActiveLoans: 5, openQueueBookIds: rejected ? [] : ['book'] } } });
    if (path === `/api/reservations/${id}/accept`) { rejected = true; return route.fulfill({ status: 409, json: { error: { code: 'RESERVATION_REJECTED_LIMIT' } } }); }
    throw new Error(`API inesperada: ${path}`);
  });
  await page.goto('/prestamos');
  // Incluso con cinco préstamos, la acción llega al servidor para liberar la reserva inmediatamente.
  await page.getByRole('button', { name: 'Aceptar préstamo', exact: true }).click();
  await expect(page.locator('.reserve-row')).toHaveCount(0);
  await expect(page.getByText('La reserva se canceló porque ya tenés cinco préstamos activos.', { exact: false })).toBeVisible();
});
