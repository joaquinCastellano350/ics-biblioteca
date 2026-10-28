import { expect, test, type Page } from '@playwright/test';
import type { AuthResponse } from '../src/app/auth/auth.types';
import type { PersonalCirculation } from '../src/app/loans/loan-query.types';

function session(): AuthResponse {
  const now = new Date();
  return {
    user: { id: 'usuario', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org',
      university: { id: 'facultad', name: 'Facultad' } },
    session: { createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 21600000).toISOString() },
    serverTime: now.toISOString(),
  };
}

function circulation(identity: AuthResponse): PersonalCirculation {
  const now = Date.parse(identity.serverTime);
  return { serverTime: identity.serverTime,
    loans: [{ id: 'loan', book: { id: 'book-loan', title: 'Préstamo privado de Ana' },
      startedAt: identity.serverTime, dueAt: new Date(now + 480 * 3_600_000).toISOString() }],
    waits: [{ id: 'wait', book: { id: 'book-wait', title: 'Espera privada de Ana' }, joinedAt: identity.serverTime, position: 2 }],
    reservations: [{ id: 'reservation', queueEntryId: 'offered', book: { id: 'book-reservation', title: 'Reserva privada de Ana' },
      offeredAt: identity.serverTime, expiresAt: new Date(now + 24 * 3_600_000).toISOString() }],
    requestConstraints: { activeLoanCount: 1, maxActiveLoans: 5, openQueueBookIds: ['book-wait', 'book-reservation'] } };
}

async function expectCirculation(page: Page, data: PersonalCirculation) {
  await expect(page.locator('.loan-card')).toContainText(data.loans[0]!.book.title);
  await expect(page.locator('.loan-card time')).toHaveAttribute('datetime', data.loans[0]!.dueAt);
  await expect(page.locator('.waiting-item')).toContainText(data.waits[0]!.book.title);
  await expect(page.locator('.waiting-item strong')).toHaveText('2');
  await expect(page.locator('.reserve-row')).toContainText(data.reservations[0]!.book.title);
  await expect(page.locator('.reserve-row time')).toHaveAttribute('datetime', data.reservations[0]!.expiresAt);
}

test('Mis préstamos pide login, conserva la ruta y restaura la sesión al recargar', async ({ page }, testInfo) => {
  let authenticated = false;
  const identity = session();
  const data = circulation(identity);
  let personalRequests = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/books') return route.fulfill({ json: { books: [] } });
    if (path === '/api/subjects') return route.fulfill({ json: { subjects: [] } });
    if (path === '/api/auth/session') return route.fulfill({
      status: authenticated ? 200 : 401,
      json: authenticated ? identity : { error: { code: 'AUTH_REQUIRED' } },
    });
    if (path === '/api/me/circulation') {
      expect(authenticated).toBe(true);
      expect(route.request().method()).toBe('GET');
      personalRequests++;
      return route.fulfill({ json: data });
    }
    if (path === '/api/auth/login') {
      expect(route.request().postDataJSON()).toEqual({ email: 'ana@example.org', password: 'mi contraseña' });
      authenticated = true;
      return route.fulfill({ json: identity });
    }
    if (path === '/api/auth/logout') {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-biblioteca-request']).toBe('1');
      authenticated = false;
      return route.fulfill({ status: 204 });
    }
    await route.abort();
    throw new Error(`API inesperada: ${path}`);
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Mis préstamos', exact: true }).click();
  await expect(page).toHaveURL(/\/prestamos$/);
  await expect(page.getByRole('heading', { name: 'Mis préstamos', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mis préstamos', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Registrate', exact: true })).toHaveAttribute('href', '/registro');
  await expect(page.locator('.loan-card, .waiting-item, .reserve-row')).toHaveCount(0);
  expect(personalRequests).toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('loans-anonymous.png'), fullPage: true });

  const opener = page.getByRole('button', { name: 'Ingresar a mi cuenta', exact: true });
  const dialog = page.getByRole('dialog');
  const email = dialog.getByLabel('Correo electrónico', { exact: true });
  const password = dialog.getByLabel('Contraseña', { exact: true });
  await opener.click();
  await expect(dialog).toBeVisible();
  // PrimeNG aplica el autofocus en onShow, al terminar la transición de entrada.
  await expect(dialog).not.toHaveAttribute('data-enter-phase', '');
  await expect(email).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/\/prestamos$/);
  await opener.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-enter-phase', '');
  await expect(email).toBeFocused();
  await email.fill('ana@example.org');
  await password.fill('mi contraseña');
  await expect(email).toHaveValue('ana@example.org');
  await expect(password).toHaveValue('mi contraseña');
  await dialog.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectCirculation(page, data);
  await expect(opener).toHaveCount(0);
  await expect(page).toHaveURL(/\/prestamos$/);
  await expect(page.getByText('Hola, Ana')).toBeVisible();
  const restored = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/session' && response.status() === 200);
  await page.reload();
  await restored;
  await expectCirculation(page, data);
  await expect(page.getByText('Hola, Ana')).toBeVisible();
  await page.getByRole('link', { name: 'Saltar al contenido', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/\/prestamos$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('loans-authenticated.png'), fullPage: true });
  await page.getByRole('link', { name: 'Explorar catálogo', exact: true }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByText('Hola, Ana')).toHaveCount(0);
  const requestsAfterLogout = personalRequests;
  await page.getByRole('link', { name: 'Mis préstamos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ingresar a mi cuenta', exact: true })).toBeVisible();
  await expect(page.locator('.loan-card, .waiting-item, .reserve-row')).toHaveCount(0);
  expect(personalRequests).toBe(requestsAfterLogout);
});

test('la URL directa espera la sesión y permite recuperarse de un error de comprobación', async ({ page }) => {
  let fail = true;
  const identity = session();
  let resolveSession!: () => void;
  const waiting = new Promise<void>(resolve => { resolveSession = resolve; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/subjects') return route.fulfill({ json: { subjects: [] } });
    if (path === '/api/me/circulation') {
      expect(fail).toBe(false);
      return route.fulfill({ json: { serverTime: identity.serverTime, loans: [], waits: [], reservations: [],
        requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } } satisfies PersonalCirculation });
    }
    if (path !== '/api/auth/session') { await route.abort(); throw new Error(`API inesperada: ${path}`); }
    await waiting;
    return route.fulfill({ status: fail ? 503 : 200,
      json: fail ? { error: { code: 'SERVICE_UNAVAILABLE' } } : identity });
  });
  await page.goto('/prestamos?origen=directo');
  await expect(page.getByRole('progressbar', { name: 'Comprobando sesión' })).toBeVisible();
  await expect(page.locator('.loan-card, .waiting-item, .reserve-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ingresar a mi cuenta', exact: true })).toHaveCount(0);
  resolveSession();
  await expect(page.getByText('Tu sesión todavía no está confirmada')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Reintentar sesión', exact: true }).click();
  await expect(page.getByText('No tenés préstamos activos.', { exact: true })).toBeVisible();
  await expect(page.getByText('No estás esperando ningún libro.', { exact: true })).toBeVisible();
  await expect(page.getByText('No tenés reservas disponibles para aceptar.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/prestamos\?origen=directo$/);
});
