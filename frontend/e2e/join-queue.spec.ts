import { expect, test, type Page } from '@playwright/test';
import type { AuthResponse } from '../src/app/auth/auth.types';
import type { PersonalCirculation } from '../src/app/loans/loan-query.types';
import type { QueueResponse } from '../src/app/loans/queue-service';

const book = { id: '11111111-1111-4111-8111-111111111111', title: 'Redes de computadoras',
  authors: [{ id: 'author', name: 'Ana Pérez' }], subjects: [], availability: { availableCopies: 0, totalCopies: 1 } };

function session(firstName = 'Ana'): AuthResponse {
  const now = new Date();
  return { user: { id: firstName === 'Ana' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    firstName, lastName: 'Prueba', email: `${firstName.toLowerCase()}@example.org`,
    university: { id: 'university', name: 'Universidad' } },
    session: { createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString() }, serverTime: now.toISOString() };
}

function empty(serverTime = new Date().toISOString()): PersonalCirculation {
  return { serverTime, loans: [], waits: [], reservations: [],
    requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } };
}

function waiting(position = 3): PersonalCirculation {
  const snapshot = empty();
  return { ...snapshot, waits: [{ id: 'entry', book: { id: book.id, title: book.title }, joinedAt: snapshot.serverTime, position }],
    requestConstraints: { ...snapshot.requestConstraints, openQueueBookIds: [book.id] } };
}

async function mockApi(page: Page, options: { visitor?: boolean; status?: 200 | 201; offered?: boolean; hold?: boolean } = {}) {
  const identity = session();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const api = { session: options.visitor ? null : identity as AuthResponse | null, personal: empty(),
    queueRequests: 0, personalRequests: 0, logins: 0, bookQueries: [] as string[], error: null as string | null, release };
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (path === '/api/auth/session') return route.fulfill({ status: api.session ? 200 : 401,
      json: api.session ?? { error: { code: 'AUTH_REQUIRED' } } });
    if (path === '/api/subjects') return route.fulfill({ json: { subjects: [] } });
    if (path === '/api/books') {
      api.bookQueries.push(url.searchParams.get('title') ?? '');
      return route.fulfill({ json: { books: [book] } });
    }
    if (path === '/api/auth/login') {
      expect(request.method()).toBe('POST');
      expect(request.postDataJSON()).toEqual({ email: 'ana@example.org', password: 'clave de prueba' });
      api.session = identity; api.logins++;
      return route.fulfill({ json: identity });
    }
    if (path === '/api/auth/logout') {
      expect(request.method()).toBe('POST'); expect(request.headers()['x-biblioteca-request']).toBe('1');
      api.session = null; api.personal = empty(); return route.fulfill({ status: 204 });
    }
    if (path === '/api/me/circulation') {
      expect(request.method()).toBe('GET'); expect(api.session).not.toBeNull();
      expect(url.searchParams.size).toBe(0); api.personalRequests++;
      return route.fulfill({ json: api.personal });
    }
    if (path === '/api/queue-entries') {
      expect(api.session).not.toBeNull(); expect(request.method()).toBe('POST');
      expect(request.postDataJSON()).toEqual({ bookId: book.id });
      expect(request.headers()['x-biblioteca-request']).toBe('1');
      api.queueRequests++;
      if (options.hold) await gate;
      if (api.error) return route.fulfill({ status: api.error === 'CIRCULATION_RECONCILIATION_REQUIRED' ? 503 : 409,
        json: { error: { code: api.error, message: 'detalle interno que no debe mostrarse' } } });
      const snapshot = waiting(options.status === 200 ? 4 : 3);
      const offered = !!options.offered;
      api.personal = offered ? { ...snapshot, waits: [] } : snapshot;
      const base = { id: 'entry', book: { id: book.id, title: book.title }, joinedAt: snapshot.serverTime };
      const result: QueueResponse = { serverTime: snapshot.serverTime,
        entry: offered ? { ...base, state: 'OFFERED', position: null } : { ...base, state: 'WAITING', position: options.status === 200 ? 4 : 3 } };
      return route.fulfill({ status: options.status ?? 201, json: result });
    }
    await route.abort();
    throw new Error(`API inesperada: ${request.method()} ${path}`);
  });
  return api;
}

const queueButton = (page: Page) => page.getByRole('button', { name: `Unirse a la cola de ${book.title}`, exact: true });
const loanButton = (page: Page) => page.getByRole('button', { name: `Solicitar préstamo de ${book.title}`, exact: true });

async function openQueue(page: Page) {
  await queueButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('data-enter-phase', '');
  await expect(dialog).toContainText('Confirmá tu inscripción en la cola');
  return dialog;
}

test('la tarjeta grisada conserva cola accesible por teclado sin habilitar el préstamo', async ({ page }, testInfo) => {
  const api = await mockApi(page); await page.goto('/catalogo');
  await expect(page.getByRole('article')).toHaveClass(/unavailable/);
  await expect(loanButton(page)).toBeDisabled(); await expect(queueButton(page)).toBeEnabled();
  await expect(page.getByRole('article')).not.toHaveAttribute('aria-disabled', 'true');
  await queueButton(page).focus(); await expect(queueButton(page)).toBeFocused(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Confirmá tu inscripción');
  await expect(dialog).not.toHaveAttribute('data-enter-phase', '');
  expect(api.queueRequests).toBe(0);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(queueButton(page)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cola-tarjeta-grisada.png'), fullPage: true });
});

test('el visitante inicia sesión y debe volver a confirmar explícitamente la inscripción', async ({ page }) => {
  const api = await mockApi(page, { visitor: true }); await page.goto('/catalogo?q=redes');
  await queueButton(page).click(); const login = page.getByRole('dialog');
  await expect(login).toContainText('Qué bueno verte de nuevo'); await expect(login).not.toHaveAttribute('data-enter-phase', '');
  const email = login.getByLabel('Correo electrónico', { exact: true }); const password = login.getByLabel('Contraseña', { exact: true });
  await expect(email).toBeFocused(); expect(api.personalRequests).toBe(0); expect(api.queueRequests).toBe(0);
  await email.fill('ana@example.org'); await password.fill('clave de prueba');
  await expect(email).toHaveValue('ana@example.org'); await expect(password).toHaveValue('clave de prueba');
  await login.getByRole('button', { name: 'Ingresar', exact: true }).click(); await expect(login).toHaveCount(0);
  await expect(queueButton(page)).toBeEnabled(); expect(api.logins).toBe(1); expect(api.queueRequests).toBe(0);
  const dialog = await openQueue(page); expect(api.queueRequests).toBe(0);
  await dialog.getByRole('button', { name: 'Confirmar inscripción', exact: true }).click();
  await expect(dialog).toContainText('Tu posición actual es 3'); expect(api.queueRequests).toBe(1);
  await expect(page).toHaveURL(/\/catalogo\?q=redes$/);
});

test('Escape conserva un foco estable mientras se actualiza y luego vuelve a la cola', async ({ page }) => {
  const api = await mockApi(page); await page.goto('/catalogo?q=redes');
  await expect(queueButton(page)).toBeEnabled();
  await queueButton(page).focus();
  const dialog = await openQueue(page);
  let release!: () => Promise<void>;
  let requested!: () => void;
  const requestStarted = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/api/me/circulation', async route => {
    api.personalRequests++;
    await new Promise<void>(resume => {
      release = async () => { await route.fulfill({ json: api.personal }); resume(); };
      requested();
    });
  });
  const before = api.personalRequests;
  await page.keyboard.press('Escape'); await requestStarted;
  await expect(dialog).toHaveCount(0);
  await expect(queueButton(page)).toBeDisabled();
  await expect(page.locator('#main-content')).toBeFocused();
  await release();
  await expect(queueButton(page)).toBeEnabled(); await expect(queueButton(page)).toBeFocused();
  expect(api.personalRequests).toBe(before + 1); expect(api.queueRequests).toBe(0);
  await expect(page).toHaveURL(/\/catalogo\?q=redes$/);
});

test('201 único pese a clics repetidos; actualiza posición, conserva filtros y protege datos tras logout', async ({ page }) => {
  const api = await mockApi(page, { hold: true }); await page.goto('/catalogo?q=redes#resultados');
  const search = page.getByRole('searchbox', { name: 'Buscar por título' });
  const filtered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/books'
    && new URL(response.url()).searchParams.get('title') === 'Redes');
  await search.fill('Redes'); await filtered;
  const dialog = await openQueue(page);
  await dialog.getByRole('button', { name: 'Confirmar inscripción', exact: true }).click();
  const pending = dialog.getByRole('button', { name: 'Confirmando…', exact: true });
  await expect(pending).toBeDisabled(); await expect(pending.locator('[data-p-icon="spinner"]')).toBeVisible();
  await pending.dispatchEvent('click'); await pending.dispatchEvent('click');
  await expect.poll(() => api.queueRequests).toBe(1); api.release();
  await expect(dialog).toContainText('Tu posición actual es 3');
  await expect(page.locator('.personal-state')).toContainText('Tu posición en cola: 3');
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(queueButton(page)).toBeDisabled(); await expect(search).toHaveValue('Redes');
  await expect(page).toHaveURL(/\/catalogo\?q=redes#resultados$/);
  await expect.poll(() => api.bookQueries.at(-1)).toBe('Redes'); expect(api.queueRequests).toBe(1);
  await page.getByRole('link', { name: 'Mis préstamos', exact: true }).click(); await expect(page).toHaveURL(/\/prestamos$/);
  await expect(page.locator('.waiting-item')).toContainText(book.title); await expect(page.locator('.waiting-item strong')).toHaveText('3');
  await expect(page.locator('.loan-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ingresar a mi cuenta', exact: true })).toBeVisible();
  await expect(page.locator('.waiting-item')).toHaveCount(0); await expect(page.getByText('Hola, Ana')).toHaveCount(0);
  await expect(page).toHaveURL(/\/prestamos$/); expect(api.queueRequests).toBe(1);
});

test('200 WAITING recupera la entrada existente y no permite otro envío', async ({ page }) => {
  const api = await mockApi(page, { status: 200 }); await page.goto('/catalogo'); const dialog = await openQueue(page);
  await dialog.getByRole('button', { name: 'Confirmar inscripción', exact: true }).click();
  await expect(dialog).toContainText('Tu posición actual es 4');
  await expect(dialog.getByRole('button', { name: 'Confirmar inscripción', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click(); await expect(queueButton(page)).toBeDisabled();
  await queueButton(page).dispatchEvent('click'); await expect(dialog).toHaveCount(0); expect(api.queueRequests).toBe(1);
});

test('200 OFFERED no inventa posición ni reserva vigente y conserva conciliación pendiente', async ({ page }) => {
  const api = await mockApi(page, { status: 200, offered: true }); await page.goto('/catalogo'); const dialog = await openQueue(page);
  await dialog.getByRole('button', { name: 'Confirmar inscripción', exact: true }).click();
  await expect(dialog).toContainText('turno ofrecido'); await expect(dialog).not.toContainText('Tu posición actual');
  await expect(page.locator('.personal-state')).toContainText('Conciliación pendiente');
  await expect(queueButton(page)).toBeDisabled(); await expect(loanButton(page)).toBeDisabled();
  await dialog.getByRole('link', { name: 'Consultar mis préstamos', exact: true }).click();
  await expect(page).toHaveURL(/\/prestamos$/); await expect(page.getByText('No estás esperando ningún libro.', { exact: true })).toBeVisible();
  await expect(page.getByText('No tenés reservas disponibles para aceptar.', { exact: true })).toBeVisible();
  await expect(page.locator('.reserve-row, .waiting-item')).toHaveCount(0); expect(api.queueRequests).toBe(1);
});

for (const [code, message] of [
  ['LOAN_LIMIT_REACHED', 'Ya tenés cinco préstamos activos'],
  ['BOOK_ALREADY_BORROWED', 'Ya tenés este libro prestado'],
  ['CIRCULATION_RECONCILIATION_REQUIRED', 'El estado de este libro necesita actualizarse'],
]) {
  test(`explica el rechazo ${code} sin fingir éxito ni reintentar automáticamente`, async ({ page }) => {
    const api = await mockApi(page); api.error = code!; await page.goto('/catalogo'); const dialog = await openQueue(page);
    await dialog.getByRole('button', { name: 'Confirmar inscripción', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(message!);
    await expect(dialog).not.toContainText('detalle interno'); await expect(dialog).not.toContainText('Tu posición actual');
    expect(api.queueRequests).toBe(1);
    if (code === 'CIRCULATION_RECONCILIATION_REQUIRED') {
      api.error = null;
      await dialog.getByRole('button', { name: 'Reintentar inscripción', exact: true }).click();
      await expect(dialog).toContainText('Tu posición actual es 3'); expect(api.queueRequests).toBe(2);
    } else {
      await expect(dialog.getByRole('button', { name: 'Confirmar inscripción', exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Volver al catálogo', exact: true }).click();
      await expect(dialog).toHaveCount(0); expect(api.queueRequests).toBe(1);
    }
  });
}

for (const ownBook of [false, true]) {
  test(`el estado conocido bloquea la cola por ${ownBook ? 'préstamo propio' : 'cinco préstamos'}`, async ({ page }) => {
    const api = await mockApi(page); const startedAt = api.personal.serverTime;
    api.personal = { ...empty(startedAt), loans: Array.from({ length: ownBook ? 1 : 5 }, (_, index) => ({ id: `loan-${index}`,
      book: ownBook ? { id: book.id, title: book.title } : { id: `another-${index}`, title: 'Otro libro' },
      startedAt, dueAt: new Date(Date.parse(startedAt) + 480 * 3_600_000).toISOString() })),
      requestConstraints: { activeLoanCount: ownBook ? 1 : 5, maxActiveLoans: 5, openQueueBookIds: [] } };
    await page.goto('/catalogo'); await expect(page.locator('.personal-state')).toContainText(ownBook ? 'Lo tenés prestado' : 'Tenés cinco préstamos activos');
    await expect(queueButton(page)).toBeDisabled();
    const reason = await queueButton(page).getAttribute('aria-describedby'); expect(reason).toBeTruthy();
    await expect(page.locator(`[id="${reason}"]`)).toContainText(ownBook ? 'Ya tenés este libro prestado' : 'cinco préstamos');
    await queueButton(page).dispatchEvent('click'); await expect(page.getByRole('dialog')).toHaveCount(0); expect(api.queueRequests).toBe(0);
  });
}

test('cambiar de cuenta retira posiciones anteriores sin perder el catálogo público', async ({ page }) => {
  const api = await mockApi(page); api.personal = waiting(7); await page.goto('/catalogo?q=redes');
  await expect(page.locator('.personal-state')).toContainText('Tu posición en cola: 7'); await expect(queueButton(page)).toBeDisabled();
  api.session = session('Bea'); api.personal = empty();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Hola, Bea')).toBeVisible(); await expect(page.locator('.personal-state')).toHaveCount(0);
  await expect(queueButton(page)).toBeEnabled(); await expect(page.getByRole('article')).toContainText(book.title);
  await expect(page).toHaveURL(/\/catalogo\?q=redes$/); expect(api.queueRequests).toBe(0);
});
