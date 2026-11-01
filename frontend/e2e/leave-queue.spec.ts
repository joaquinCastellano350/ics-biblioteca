import { expect, test, type Page } from '@playwright/test';
import type { AuthResponse } from '../src/app/auth/auth.types';
import type { PersonalCirculation } from '../src/app/loans/loan-query.types';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const foreignId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const offeredId = '33333333-3333-4333-8333-333333333333';
const firstTitle = 'Redes en espera de Ana';
const secondTitle = 'Sistemas en espera de Ana';

function session(name = 'Ana'): AuthResponse {
  const now = new Date();
  return { user: { id: name === 'Ana' ? 'ana' : 'bea', firstName: name, lastName: 'Prueba',
    email: `${name.toLowerCase()}@example.org`, university: { id: 'uni', name: 'Universidad' } },
    session: { createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 21600000).toISOString() },
    serverTime: now.toISOString() };
}

function personal(identity: AuthResponse): PersonalCirculation {
  const serverTime = identity.serverTime;
  return { serverTime, loans: [],
    waits: [{ id: firstId, book: { id: 'book-a', title: firstTitle }, joinedAt: serverTime, position: 3 },
      { id: secondId, book: { id: 'book-b', title: secondTitle }, joinedAt: serverTime, position: 5 }],
    reservations: [{ id: 'reservation', queueEntryId: offeredId, book: { id: 'book-c', title: 'Reserva vigente de Ana' },
      offeredAt: serverTime, expiresAt: new Date(Date.parse(serverTime) + 86400000).toISOString() }],
    requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: ['book-a', 'book-b', 'book-c', 'offered-without-reservation'] } };
}

function empty(identity: AuthResponse): PersonalCirculation {
  return { serverTime: identity.serverTime, loans: [], waits: [], reservations: [],
    requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } };
}

async function mockApi(page: Page, hold = false) {
  const identity = session();
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  let finished!: () => void;
  const completed = new Promise<void>(resolve => { finished = resolve; });
  const api = { session: identity as AuthResponse | null, personal: personal(identity),
    cancellations: [] as string[], personalRequests: 0, error: null as { status: number; code: string } | null,
    async release() { resume(); await completed; } };
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (path === '/api/auth/session') return route.fulfill({ status: api.session ? 200 : 401,
      json: api.session ?? { error: { code: 'AUTH_REQUIRED' } } });
    if (path === '/api/me/circulation') {
      expect(api.session).not.toBeNull(); expect(request.method()).toBe('GET');
      expect(url.searchParams.size).toBe(0); api.personalRequests++;
      return route.fulfill({ json: api.personal });
    }
    if (path === '/api/auth/logout') {
      expect(request.method()).toBe('POST');
      api.session = null; api.personal = empty(identity);
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/subjects') return route.fulfill({ json: { subjects: [] } });
    if (path === '/api/books') return route.fulfill({ json: { books: [] } });
    const entryId = [firstId, offeredId].find(id => path === `/api/queue-entries/${id}/cancel`);
    if (entryId) {
      expect(request.method()).toBe('POST'); expect(api.session).not.toBeNull();
      expect(url.searchParams.size).toBe(0);
      expect(request.headers()['x-biblioteca-request']).toBe('1');
      expect(request.headers()['content-type']).toBe('application/json');
      expect(request.postDataJSON()).toEqual({});
      expect(request.headers()['authorization']).toBeUndefined();
      const owner = api.session;
      api.cancellations.push(path);
      if (hold) await gate;
      try {
        if (api.error) return await route.fulfill({ status: api.error.status,
          json: { error: { code: api.error.code, message: 'detalle interno que no debe mostrarse' } } });
        if (api.session === owner) api.personal = { ...api.personal,
          waits: api.personal.waits.filter(wait => wait.id !== entryId),
          reservations: api.personal.reservations.filter(reservation => reservation.queueEntryId !== entryId),
          requestConstraints: { ...api.personal.requestConstraints, openQueueBookIds: api.personal.requestConstraints.openQueueBookIds
            .filter(id => id !== (entryId === firstId ? 'book-a' : 'book-c')) } };
        return await route.fulfill({ status: 204 });
      } finally { finished(); }
    }
    await route.abort();
    throw new Error(`API inesperada: ${request.method()} ${path}`);
  });
  return api;
}

const leave = (page: Page) => page.getByRole('button', { name: `Salir de la cola de ${firstTitle}`, exact: true });
const confirmation = (page: Page) => page.getByRole('dialog', { name: 'Salir de la cola', exact: true });

async function openConfirmation(page: Page) {
  await leave(page).click();
  const dialog = confirmation(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-enter-phase', '');
  await expect(dialog.getByRole('button', { name: 'Seguir esperando', exact: true })).toBeFocused();
  await expect(dialog).toContainText(firstTitle);
  return dialog;
}

test('solo muestra salidas para esperas propias; no permite seleccionar un identificador ajeno por URL', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/prestamos?entryId=${foreignId}`);
  await expect(page.locator('.waiting-item')).toHaveCount(2);
  await expect(page.locator('.waiting-item strong')).toHaveText(['3', '5']);
  await expect(page.locator('.waiting-item p-button button')).toHaveCount(2);
  await expect(page.locator('.reserve-row')).toContainText('Reserva vigente de Ana');
  await expect(page.locator('.reserve-row button')).toHaveAccessibleName('Salir de la cola de Reserva vigente de Ana');
  await expect(page.locator('.reserve-row button')).toBeEnabled();
  await expect(page.getByText(foreignId, { exact: true })).toHaveCount(0);
  const dialog = await openConfirmation(page);
  await dialog.getByRole('button', { name: 'Confirmar salida', exact: true }).click();
  await expect(page.locator('.waiting-item')).toHaveCount(1);
  expect(api.cancellations).toEqual([`/api/queue-entries/${firstId}/cancel`]);
  await expect(page.locator('.reserve-row')).toContainText('Reserva vigente de Ana');
  await expect(page.getByText('No tenés reservas disponibles para aceptar.', { exact: true })).toHaveCount(0);
});

test('confirmación PrimeNG por teclado; Escape y Seguir esperando no envían POST y recuperan el foco', async ({ page }) => {
  const api = await mockApi(page); await page.goto('/prestamos');
  await leave(page).focus(); await expect(leave(page)).toBeFocused(); await page.keyboard.press('Enter');
  const dialog = confirmation(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-enter-phase', '');
  await expect(dialog.getByRole('button', { name: 'Seguir esperando', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(leave(page)).toBeFocused();
  await openConfirmation(page);
  await page.keyboard.press('Enter'); await expect(dialog).toHaveCount(0); await expect(leave(page)).toBeFocused();
  expect(api.cancellations).toEqual([]); expect(api.personalRequests).toBe(1);
  await expect(page.locator('.waiting-item')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('204 único actualiza circulación, retira solo la espera elegida y devuelve foco al contenido', async ({ page }) => {
  const api = await mockApi(page, true); await page.goto('/prestamos?estado=vigentes#contenido');
  const dialog = await openConfirmation(page);
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Confirmar salida', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const pending = dialog.getByRole('button', { name: 'Saliendo…', exact: true });
  await expect(pending).toBeDisabled(); await expect(pending.locator('[data-p-icon="spinner"]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Seguir esperando', exact: true })).toBeDisabled();
  await pending.dispatchEvent('click'); await pending.dispatchEvent('click');
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(dialog.locator('#leave-queue-description')).toBeFocused();
  await expect(pending.locator('[data-p-icon="spinner"]')).toBeVisible();
  expect(api.cancellations).toHaveLength(1);
  await api.release();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.waiting-item')).toHaveCount(1);
  await expect(page.locator('.waiting-item')).toContainText(secondTitle);
  await expect(page.locator('.waiting-item strong')).toHaveText('5');
  await expect(leave(page)).toHaveCount(0);
  await expect(page.locator('.reserve-row')).toContainText('Reserva vigente de Ana');
  await expect(page.getByRole('main')).toBeFocused();
  expect(api.personalRequests).toBe(2); expect(api.cancellations).toHaveLength(1);
  await expect(page).toHaveURL(/\/prestamos\?estado=vigentes#contenido$/);
});

for (const error of [
  { status: 404, code: 'QUEUE_ENTRY_NOT_FOUND', message: 'Esta espera ya no está disponible' },
  { status: 409, code: 'QUEUE_ENTRY_FULFILLED', message: 'Esta espera ya se utilizó para obtener un préstamo' },
  { status: 503, code: 'CIRCULATION_RECONCILIATION_REQUIRED', message: 'Esta espera necesita actualizarse' },
]) {
  test(`el error ${error.status} conserva la espera y permite reintento explícito sin éxito ficticio`, async ({ page }) => {
    const api = await mockApi(page); api.error = error; await page.goto('/prestamos');
    const dialog = await openConfirmation(page);
    await dialog.getByRole('button', { name: 'Confirmar salida', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(error.message);
    await expect(dialog).not.toContainText('detalle interno');
    await expect(page.locator('.waiting-item')).toHaveCount(2);
    expect(api.personalRequests).toBe(1); expect(api.cancellations).toHaveLength(1);
    api.error = null;
    await dialog.getByRole('button', { name: 'Reintentar salida', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(page.locator('.waiting-item')).toHaveCount(1);
    expect(api.cancellations).toHaveLength(2); expect(api.personalRequests).toBe(2);
  });
}

for (const reservation of [false, true]) {
for (const change of ['logout', 'account']) {
  test(`una cancelación pendiente no altera datos tras ${change}; reserva=${reservation}`, async ({ page }) => {
    const api = await mockApi(page, true); await page.goto('/prestamos');
    const dialog = reservation ? await openReservationConfirmation(page) : await openConfirmation(page);
    await dialog.getByRole('button', { name: 'Confirmar salida', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Saliendo…', exact: true })).toBeDisabled();
    const aborted = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith(`/${reservation ? offeredId : firstId}/cancel`) });
    if (change === 'logout') {
      // El diálogo modal impide interactuar con la cabecera; el clic DOM representa
      // un cierre de sesión concurrente, sin desactivar el modal ni cambiar producción.
      await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).dispatchEvent('click');
      await expect(page.getByRole('button', { name: 'Ingresar a mi cuenta', exact: true })).toBeVisible();
    } else {
      api.session = session('Bea'); api.personal = { ...empty(api.session),
        waits: [{ id: 'bea-wait', book: { id: 'bea-book', title: 'Espera privada de Bea' }, joinedAt: api.session.serverTime, position: 7 }],
        requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: ['bea-book'] } };
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.getByText('Hola, Bea')).toBeVisible();
      await expect(page.locator('.waiting-item')).toContainText('Espera privada de Bea');
    }
    await aborted; await expect(dialog).toHaveCount(0);
    const personalRequests = api.personalRequests;
    await api.release();
    await expect(page.getByText(firstTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Reserva vigente de Ana', { exact: true })).toHaveCount(0);
    if (change === 'account') {
      await expect(page.locator('.waiting-item strong')).toHaveText('7');
      await expect(page.getByRole('button', { name: 'Salir de la cola de Espera privada de Bea', exact: true })).toBeEnabled();
    } else await expect(page.locator('.waiting-item')).toHaveCount(0);
    expect(api.personalRequests).toBe(personalRequests); expect(api.cancellations).toHaveLength(1);
    await expect(page).toHaveURL(/\/prestamos$/);
  });
}
}

const leaveReservation = (page: Page) => page.getByRole('button', { name: 'Salir de la cola de Reserva vigente de Ana', exact: true });

async function openReservationConfirmation(page: Page) {
  await leaveReservation(page).click();
  const dialog = confirmation(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-enter-phase', '');
  await expect(dialog).toContainText('perdés este turno y liberás el cupo');
  await expect(dialog.getByRole('button', { name: 'Conservar turno', exact: true })).toBeFocused();
  return dialog;
}

test('reserva propia: Escape y Conservar turno mantienen el cupo sin POST y restauran foco', async ({ page }) => {
  const api = await mockApi(page); await page.goto('/prestamos');
  const dialog = await openReservationConfirmation(page);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(leaveReservation(page)).toBeFocused();
  await openReservationConfirmation(page); await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0); await expect(leaveReservation(page)).toBeFocused();
  await expect(page.locator('.reserve-row')).toContainText('Reserva vigente de Ana');
  await expect(page.locator('.waiting-item')).toHaveCount(2);
  expect(api.cancellations).toEqual([]); expect(api.personalRequests).toBe(1);
});

for (const fails of [false, true]) {
  test(`reserva HELD: Escape no interrumpe el POST; éxito y reintento 503=${fails}`, async ({ page }) => {
    const api = await mockApi(page, true);
    const original = api.personal.reservations[0]!;
    api.personal = { ...api.personal, reservations: [...api.personal.reservations,
      { ...original, id: 'other-reservation', queueEntryId: 'another-offer', book: { id: 'other-book', title: 'Otra reserva propia' } }] };
    if (fails) api.error = { status: 503, code: 'CIRCULATION_RECONCILIATION_REQUIRED' };
    const failedRequests: string[] = [];
    page.on('requestfailed', request => { if (request.url().endsWith(`/${offeredId}/cancel`)) failedRequests.push(request.url()); });
    await page.goto('/prestamos?estado=vigentes#contenido');
    const dialog = await openReservationConfirmation(page);
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Confirmar salida', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    const pending = dialog.getByRole('button', { name: 'Saliendo…', exact: true });
    await expect(pending).toBeDisabled();
    await expect(pending.locator('[data-p-icon="spinner"]')).toBeVisible();
    await expect(dialog.locator('#leave-queue-description')).toBeFocused();
    await pending.dispatchEvent('click'); await pending.dispatchEvent('click');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible(); await expect(dialog.locator('#leave-queue-description')).toBeFocused();
    await expect(page.locator('.reserve-row')).toHaveCount(2);
    expect(api.personalRequests).toBe(1);
    expect(api.cancellations).toEqual([`/api/queue-entries/${offeredId}/cancel`]);
    await api.release();
    if (fails) {
      await expect(dialog.getByRole('alert')).toContainText('Esta reserva necesita actualizarse');
      await expect(page.locator('.reserve-row')).toHaveCount(2);
      expect(api.personalRequests).toBe(1);
      api.error = null;
      await dialog.getByRole('button', { name: 'Reintentar salida', exact: true }).click();
    }
    await expect(dialog).toHaveCount(0); await expect(leaveReservation(page)).toHaveCount(0);
    await expect(page.locator('.reserve-row')).toContainText('Otra reserva propia');
    await expect(page.locator('.waiting-item')).toHaveCount(2);
    await expect(page.locator('.waiting-item strong')).toHaveText(['3', '5']);
    await expect(page.getByRole('main')).toBeFocused();
    expect(failedRequests).toEqual([]);
    expect(api.cancellations).toHaveLength(fails ? 2 : 1);
    expect(api.personalRequests).toBe(2);
    await expect(page).toHaveURL(/\/prestamos\?estado=vigentes#contenido$/);
  });
}
