import { expect, test } from '@playwright/test';
import type { PersonalCirculation } from '../src/app/loans/loan-query.types';

const book = { id: '11111111-1111-4111-8111-111111111111', title: 'Sistemas distribuidos',
  authors: [{ id: 'autor', name: 'Ana Pérez' }], subjects: [{ id: 'materia', name: 'Informática' }],
  availability: { availableCopies: 1, totalCopies: 1 } };
const session = () => {
  const now = new Date();
  return { user: { id: 'ana', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org', university: { id: 'uni', name: 'Universidad' } },
    session: { createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString() }, serverTime: now.toISOString() };
};

function emptyCirculation(): PersonalCirculation {
  return { serverTime: new Date().toISOString(), loans: [], waits: [], reservations: [],
    requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } };
}

test.beforeEach(async ({ page }) => {
  // El guard se registra primero: las rutas específicas posteriores tienen prioridad.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    await route.abort();
    throw new Error(`API inesperada: ${path}`);
  });
  const identity = session();
  await page.route('**/api/auth/session', route => route.fulfill({ json: identity }));
  await page.route('**/api/me/circulation', route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: emptyCirculation() });
  });
  await page.route('**/api/subjects', route => route.fulfill({ json: { subjects: [] } }));
  await page.route('**/api/books', route => route.fulfill({ json: { books: [book] } }));
});

test('confirma desde la tarjeta, muestra vencimiento y actualiza cupos', async ({ page }, testInfo) => {
  let requests = 0;
  const startedAt = new Date();
  const dueAt = new Date(startedAt.getTime() + 480 * 3_600_000);
  await page.route('**/api/loans', async route => {
    requests++;
    expect(route.request().headers()['x-biblioteca-request']).toBe('1');
    expect(route.request().postDataJSON()).toEqual({ bookId: book.id });
    await page.route('**/api/me/circulation', route => route.fulfill({ json: {
      ...emptyCirculation(), loans: [{ id: 'prestamo', book: { id: book.id, title: book.title },
        startedAt: startedAt.toISOString(), dueAt: dueAt.toISOString() }],
      requestConstraints: { activeLoanCount: 1, maxActiveLoans: 5, openQueueBookIds: [] },
    } satisfies PersonalCirculation }));
    await route.fulfill({ status: 201, json: { loan: { id: 'prestamo', bookId: book.id, startedAt: startedAt.toISOString(), dueAt: dueAt.toISOString() } } });
  });
  await page.goto('/catalogo');
  const opener = page.getByRole('button', { name: `Solicitar préstamo de ${book.title}`, exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('480 horas');
  expect(requests).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('confirmacion.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole('button', { name: 'Confirmar préstamo', exact: true }).click();
  await expect(dialog).toContainText('Tu préstamo está confirmado');
  await expect(dialog).toContainText('Vence el');
  expect(requests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('prestamo-concedido.png'), fullPage: true });
  await page.route('**/api/books', route => route.fulfill({ json: { books: [{ ...book, availability: { availableCopies: 0, totalCopies: 1 } }] } }));
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByRole('article')).toContainText('0/1 cupos disponibles');
  await expect(page.getByRole('article')).toContainText('Lo tenés prestado');
  await expect(opener).toBeDisabled();
  expect(requests).toBe(1);
});

test('último cupo agotado: explica la cola y su integración pendiente', async ({ page }, testInfo) => {
  await page.route('**/api/loans', route => route.fulfill({ status: 409, json: { error: { code: 'NO_AVAILABLE_COPIES' } } }));
  await page.goto('/catalogo');
  await page.getByRole('button', { name: `Solicitar préstamo de ${book.title}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirmar préstamo', exact: true }).click();
  await expect(dialog).toContainText('último cupo');
  await dialog.getByRole('button', { name: 'Entrar en la cola', exact: true }).click();
  await expect(dialog).toContainText('inscripción en la cola estará disponible próximamente');
  await page.screenshot({ path: testInfo.outputPath('cupo-agotado.png'), fullPage: true });
});

test('visitante inicia sesión sin conceder automáticamente el préstamo', async ({ page }) => {
  let requests = 0;
  let authenticated = false;
  const identity = session();
  await page.route('**/api/auth/session', route => route.fulfill({ status: authenticated ? 200 : 401,
    json: authenticated ? identity : { error: { code: 'AUTH_REQUIRED' } } }));
  await page.route('**/api/loans', async route => {
    requests++;
    await route.abort();
    throw new Error('No debe solicitarse un préstamo automáticamente');
  });
  await page.route('**/api/auth/login', route => { authenticated = true; return route.fulfill({ json: identity }); });
  let personalRequests = 0;
  await page.route('**/api/me/circulation', route => {
    expect(authenticated).toBe(true);
    personalRequests++;
    return route.fulfill({ json: emptyCirculation() });
  });
  await page.goto('/catalogo');
  const opener = page.getByRole('button', { name: `Solicitar préstamo de ${book.title}` });
  await opener.click();
  expect(personalRequests).toBe(0);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Qué bueno verte de nuevo');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('ana@example.org');
  await page.getByLabel('Contraseña', { exact: true }).fill('clave');
  await dialog.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(0);
  await expect(opener).toBeEnabled();
  expect(personalRequests).toBe(1);
  await opener.click();
  await expect(dialog).toContainText('Confirmá tu préstamo');
  expect(requests).toBe(0);
});
