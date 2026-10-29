import { expect, test } from '@playwright/test';

const bookId = '11111111-1111-4111-8111-111111111111';
const loanId = '22222222-2222-4222-8222-222222222222';
const book = { id: bookId, title: 'Lectura de prueba', authors: [], subjects: [], availability: { availableCopies: 1, totalCopies: 1 } };

test('lee desde confirmación, catálogo y Mis préstamos; conserva el acceso al recargar y lo retira al salir', async ({ page, context }, testInfo) => {
  const now = new Date();
  const session = { user: { id: 'ana', firstName: 'Ana', lastName: 'Prueba', email: 'ana@example.org', university: { id: 'uni', name: 'Universidad' } },
    session: { createdAt: now.toISOString(), expiresAt: new Date(+now + 6 * 3_600_000).toISOString() }, serverTime: now.toISOString() };
  const loan = { id: loanId, bookId, startedAt: now.toISOString(), dueAt: new Date(+now + 480 * 3_600_000).toISOString() };
  let authenticated = true;
  let granted = false;
  let grants = 0;
  let reads = 0;
  // Esta prueba comprueba navegación y botones. El bucket real se verifica aparte.
  await context.route('https://assets.example.org/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Archivo autorizado de prueba</title>' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? session : { error: { code: 'AUTH_REQUIRED' } } });
    if (path === '/api/auth/logout') { authenticated = false; return route.fulfill({ status: 204 }); }
    if (path === '/api/books') return route.fulfill({ json: { books: [{ ...book, availability: { availableCopies: granted ? 0 : 1, totalCopies: 1 } }] } });
    if (path === '/api/subjects') return route.fulfill({ json: { subjects: [] } });
    if (path === '/api/me/circulation') return route.fulfill({ json: {
      serverTime: new Date().toISOString(),
      loans: granted ? [{ id: loan.id, book: { id: bookId, title: book.title }, startedAt: loan.startedAt, dueAt: loan.dueAt }] : [],
      waits: [], reservations: [], requestConstraints: { activeLoanCount: granted ? 1 : 0, maxActiveLoans: 5, openQueueBookIds: [] },
    } });
    if (path === '/api/loans') { grants++; granted = true; return route.fulfill({ status: 201, json: { loan } }); }
    if (path === `/api/loans/${loanId}/read-access`) {
      reads++;
      return route.fulfill({ json: { url: `https://assets.example.org/lectura.pdf?acceso=${reads}`, expiresAt: new Date(Date.now() + 300_000).toISOString() } });
    }
    throw new Error(`API inesperada: ${path}`);
  });
  await page.goto('/catalogo');
  await page.getByRole('button', { name: `Solicitar préstamo de ${book.title}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirmar préstamo', exact: true }).click();
  const start = dialog.getByRole('button', { name: 'Empezar a leer (abre una pestaña nueva)', exact: true });
  await expect(start).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('leer-confirmacion.png'), fullPage: true });
  const popupReady = page.waitForEvent('popup');
  await start.click();
  const popup = await popupReady;
  await popup.waitForURL('https://assets.example.org/**');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
  await page.bringToFront();
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByRole('article')).toContainText('0/1 cupos disponibles');
  const read = page.getByRole('article').getByRole('button', { name: 'Leer online (abre una pestaña nueva)', exact: true });
  await expect(read).toBeVisible();
  await expect(page.getByRole('button', { name: `Solicitar préstamo de ${book.title}`, exact: true })).toHaveCount(0);
  await page.reload();
  await expect(read).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('leer-catalogo.png'), fullPage: true });
  const secondReady = page.waitForEvent('popup');
  await read.click();
  const second = await secondReady;
  await second.waitForURL('https://assets.example.org/**');
  await second.close();
  await page.goto('/prestamos');
  const personalRead = page.locator('.loan-card').getByRole('button', { name: 'Leer online (abre una pestaña nueva)', exact: true });
  await expect(personalRead).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('leer-mis-prestamos.png'), fullPage: true });
  const thirdReady = page.waitForEvent('popup');
  await personalRead.click();
  const third = await thirdReady;
  await third.waitForURL('https://assets.example.org/**');
  expect(await third.evaluate(() => window.opener === null)).toBe(true);
  await third.close();
  expect(reads).toBe(3);
  expect(grants).toBe(1);
  await page.bringToFront();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(personalRead).toHaveCount(0);
  await expect(page.getByText('Ingresá a tu cuenta para acceder a la sección de préstamos.')).toBeVisible();
});
