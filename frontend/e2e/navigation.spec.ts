import { expect, test } from '@playwright/test';

test('landing y navegación pública sin placeholders', async ({ page }, testInfo) => {
  await page.route('**/api/books', (route) => route.fulfill({ json: { books: [] } }));
  await page.route('**/api/auth/session', route => route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED' } } }));
  await page.route('**/api/universities', route => route.fulfill({ json: { universities: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('El conocimiento');
  await page.screenshot({ path: testInfo.outputPath('landing-public.png'), fullPage: true });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Mis préstamos', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Crear cuenta', exact: true })).toHaveAttribute('href', '/registro');
  await expect(page.getByRole('link', { name: 'Crear mi cuenta', exact: true })).toHaveAttribute('href', '/registro');
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
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Inicio', exact: true }).click();
  await page.getByRole('link', { name: 'Ver el catálogo' }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
  // El salto conserva la ruta actual aun con base href="/".
  await page.getByRole('link', { name: 'Saltar al contenido' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/\/catalogo$/);
  await page.getByRole('link', { name: 'Crear cuenta', exact: true }).click();
  await expect(page).toHaveURL(/\/registro$/);
  await page.getByRole('link', { name: 'Saltar al contenido' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/\/registro$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
