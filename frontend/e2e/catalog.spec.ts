import { expect, test } from '@playwright/test';

export const books = [
  {
    id: 'test-book',
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
  await expect(page.locator('article a, article button')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('catalog.png'), fullPage: true });
});

test('distingue catálogo vacío de error y permite reintentar', async ({ page }) => {
  await page.route('**/api/books', (route) => route.fulfill({ status: 503, json: { error: 'CATALOG_UNAVAILABLE' } }));
  await page.goto('/catalogo');
  await expect(page.getByRole('alert')).toContainText('No pudimos cargar el catálogo');
  await page.route('**/api/books', (route) => route.fulfill({ json: { books: [] } }));
  await page.getByRole('button', { name: 'Volver a intentar' }).click();
  await expect(page.getByRole('heading', { name: 'La biblioteca está preparando sus estantes' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
