import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/session') return route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED' } } });
    if (url.pathname === '/api/subjects') return route.fulfill({ json: { subjects: [] } });
    if (url.pathname === '/api/authors') return route.fulfill({ json: { authors: [{ id: 'ana', name: 'Ana' }] } });
    if (url.pathname === '/api/books') return route.fulfill({ json: { books: [{
      id: 'redes', title: 'Redes', authors: [], subjects: [], availability: { availableCopies: 1, totalCopies: 1 },
    }] } });
    return route.abort();
  });
});

test('título y autores esperan 500 ms desde el último cambio', async ({ page }) => {
  const bookQueries: string[] = [];
  const authorQueries: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/books') bookQueries.push(url.searchParams.get('title') ?? '');
    if (url.pathname === '/api/authors') authorQueries.push(url.searchParams.get('q') ?? '');
  });
  await page.clock.install();
  await page.goto('/catalogo');
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(bookQueries).toEqual(['']);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  const title = page.getByRole('searchbox', { name: 'Buscar por título' });
  await title.fill('R');
  await page.clock.runFor(400);
  await title.fill('Redes de computadoras');
  await page.clock.runFor(499);
  expect(bookQueries).toEqual(['']);
  await page.clock.runFor(1);
  await expect.poll(() => bookQueries).toEqual(['', 'Redes de computadoras']);
  await page.clock.resume();

  await page.getByRole('combobox', { name: 'Filtrar por autores' }).click();
  const author = page.locator('input[aria-label="Buscar autores"]');
  await expect(author).toBeVisible();
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  await author.fill('a');
  await page.clock.runFor(400);
  await author.fill('ana');
  await page.clock.runFor(499);
  expect(authorQueries).toEqual([]);
  await page.clock.runFor(1);
  await expect.poll(() => authorQueries).toEqual(['ana']);
  await page.clock.resume();
});

test('los tres controles llenan sus columnas sin desbordar', async ({ page }, testInfo) => {
  await page.goto('/catalogo');
  await expect(page.getByRole('article')).toHaveCount(1);
  const sizes = await page.locator('.catalog-tools').evaluate(root => {
    const bounds = (selector: string) => {
      const rect = root.querySelector(selector)!.getBoundingClientRect();
      return { width: rect.width, left: rect.left, right: rect.right, centerY: rect.y + rect.height / 2 };
    };
    return {
      title: bounds('.search-field'), author: bounds('.author-filter'), subject: bounds('.subject-filter'),
      authorControl: bounds('.author-filter .p-select'), subjectControl: bounds('.subject-filter .p-select'),
      authorLabel: bounds('.author-filter .p-select-label'), authorArrow: bounds('.author-filter .p-select-dropdown'),
      subjectLabel: bounds('.subject-filter .p-select-label'), subjectArrow: bounds('.subject-filter .p-select-dropdown'),
    };
  });
  expect(Math.abs(sizes.author.width - sizes.authorControl.width)).toBeLessThan(2);
  expect(Math.abs(sizes.subject.width - sizes.subjectControl.width)).toBeLessThan(2);
  expect(Math.abs(sizes.author.width - sizes.subject.width)).toBeLessThan(2);
  for (const [label, arrow] of [[sizes.authorLabel, sizes.authorArrow], [sizes.subjectLabel, sizes.subjectArrow]]) {
    expect(label.width).toBeGreaterThan(150);
    expect(Math.abs(label.centerY - arrow.centerY)).toBeLessThan(2);
    expect(label.right).toBeLessThanOrEqual(arrow.left + 1);
  }
  if (page.viewportSize()!.width > 850 || page.viewportSize()!.width <= 600) {
    expect(Math.abs(sizes.title.width - sizes.author.width)).toBeLessThan(2);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('catalog-filter-grid.png'), fullPage: true });
});
