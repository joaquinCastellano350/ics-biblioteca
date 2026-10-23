import { expect, test } from '@playwright/test';

test('landing y navegación pública sin placeholders', async ({ page }, testInfo) => {
  await page.route('**/api/books', (route) => route.fulfill({ json: { books: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('El conocimiento');
  await page.screenshot({ path: testInfo.outputPath('landing-public.png'), fullPage: true });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  for (const name of ['Ingresar', 'Crear cuenta', 'Crear mi cuenta', 'Mis préstamos']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole('link', { name: 'Inicio', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('heading', { level: 1 }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Explorar catálogo' }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catálogo de libros');
  await expect(page.getByRole('link', { name: 'Catálogo', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Inicio', exact: true }).click();
  await page.getByRole('link', { name: 'Ver el catálogo' }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
});
