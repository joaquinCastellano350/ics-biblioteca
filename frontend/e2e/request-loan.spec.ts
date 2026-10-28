import { expect, test } from '@playwright/test';

const book = { id: '11111111-1111-4111-8111-111111111111', title: 'Sistemas distribuidos',
  authors: [{ id: 'autor', name: 'Ana Pérez' }], subjects: [{ id: 'materia', name: 'Informática' }],
  availability: { availableCopies: 1, totalCopies: 1 } };
const session = () => {
  const now = new Date();
  return { user: { id: 'ana', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org', university: { id: 'uni', name: 'Universidad' } },
    session: { createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString() }, serverTime: now.toISOString() };
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ json: session() }));
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
  await page.route('**/api/auth/session', route => route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED' } } }));
  await page.route('**/api/loans', route => { requests++; return route.abort(); });
  await page.route('**/api/auth/login', route => route.fulfill({ json: session() }));
  await page.goto('/catalogo');
  const opener = page.getByRole('button', { name: `Solicitar préstamo de ${book.title}` });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Qué bueno verte de nuevo');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('ana@example.org');
  await page.getByLabel('Contraseña', { exact: true }).fill('clave');
  await dialog.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(0);
  await opener.click();
  await expect(dialog).toContainText('Confirmá tu préstamo');
  expect(requests).toBe(0);
});
