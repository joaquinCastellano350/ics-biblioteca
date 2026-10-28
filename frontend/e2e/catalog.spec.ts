import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED' } } }));
  // El endpoint independiente de materias forma parte de la carga del catálogo.
  await page.route('**/api/subjects', route => route.fulfill({ json: { subjects: [] } }));
});

export const books = [
  {
    availability: { availableCopies: 1, totalCopies: 1 }, id: 'test-book',
    title: 'TítuloLargoSinEspacios'.repeat(12),
    authors: [
      { id: 'a1', name: 'Ana' },
      { id: 'a2', name: 'Charles E. Leiserson y colaboradores de investigación universitaria' },
    ],
    subjects: [
      { id: 's1', name: 'Ingeniería de Software' },
      { id: 's2', name: 'Sistemas de información y tecnologías para organizaciones universitarias' },
    ],
  },
];

test('catálogo público sin desbordamientos ni enlaces a fichas', async ({ page }, testInfo) => {
  // Datos exclusivos de la prueba: la aplicación productiva siempre consulta la API.
  await page.route('**/api/books', (route) => route.fulfill({ json: { books } }));
  await page.goto('/catalogo');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catálogo de libros');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.locator('article .authors li')).toHaveCount(2);
  await expect(page.locator('article .subjects li')).toHaveCount(2);
  await expect(page.locator('article a')).toHaveCount(0);
  // SCRUM-20 agrega la solicitud de préstamo; la tarjeta sigue sin abrir una ficha.
  const actions = page.getByRole('article').getByRole('button');
  await expect(actions).toHaveCount(1);
  await expect(actions).toHaveAccessibleName(`Solicitar préstamo de ${books[0]!.title}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('catalog.png'), fullPage: true });
});

test('distingue catálogo vacío de error y permite reintentar', async ({ page }) => {
  await page.route('**/api/books', (route) => route.fulfill({ status: 503, json: { error: 'CATALOG_UNAVAILABLE' } }));
  await page.goto('/catalogo');
  const catalogAlert = page.locator('.state-panel[role="alert"]');
  await expect(catalogAlert).toContainText('No pudimos cargar el catálogo');
  await expect(page.locator('.subject-error[role="alert"]')).toHaveCount(0);
  await page.route('**/api/books', (route) => route.fulfill({ json: { books: [] } }));
  await page.getByRole('button', { name: 'Volver a intentar' }).click();
  await expect(page.getByRole('heading', { name: 'La biblioteca está preparando sus estantes' })).toBeVisible();
  await expect(catalogAlert).toHaveCount(0);
  await expect(page.locator('.subject-error[role="alert"]')).toHaveCount(0);
});

test('disponibilidad pública, grisado legible y actualización al recargar', async ({ page }, testInfo) => {
  let availableCopies = 2;
  let calls = 0;
  await page.route('**/api/books', (route) => {
    calls++;
    return route.fulfill({ json: { books: [
      { ...books[0], availability: { availableCopies, totalCopies: 3 } },
      { ...books[0], id: 'sin-cupos', title: 'Álgebra universitaria', availability: { availableCopies: 0, totalCopies: 1 } },
    ] } });
  });
  await page.goto('/catalogo');
  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('2/3 cupos disponibles');
  await expect(cards.first()).not.toHaveClass(/unavailable/);
  await expect(cards.last()).toHaveClass(/unavailable/);
  await expect(cards.last()).toContainText('0/1 cupos disponibles');
  await expect(cards.last().getByRole('heading', { name: 'Álgebra universitaria' })).toBeVisible();
  await expect(cards.last()).not.toHaveAttribute('aria-disabled', 'true');
  const background = (index: number) => cards.nth(index).locator('.p-card').evaluate(element => getComputedStyle(element).backgroundColor);
  expect(await background(0)).not.toBe(await background(1));
  expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('catalog-availability.png'), fullPage: true });
  availableCopies = 0;
  await page.reload();
  await expect(cards.first()).toContainText('0/3 cupos disponibles');
  await expect(cards.first()).toHaveClass(/unavailable/);
  expect(calls).toBe(2);
});
