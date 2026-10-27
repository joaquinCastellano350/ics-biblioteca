import { expect, test } from '@playwright/test';
import type { AuthResponse } from '../src/app/auth/auth.types';

function session(): AuthResponse {
  const now = new Date();
  return {
    user: { id: 'usuario', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org',
      university: { id: 'facultad', name: 'Facultad' } },
    session: { createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 21600000).toISOString() },
    serverTime: now.toISOString(),
  };
}

test('Mis préstamos pide login, conserva la ruta y restaura la sesión al recargar', async ({ page }, testInfo) => {
  let authenticated = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/books') return route.fulfill({ json: { books: [] } });
    if (path === '/api/subjects') return route.fulfill({ json: { subjects: [] } });
    if (path === '/api/auth/session') return route.fulfill({
      status: authenticated ? 200 : 401,
      json: authenticated ? session() : { error: { code: 'AUTH_REQUIRED' } },
    });
    if (path === '/api/auth/login') {
      expect(route.request().postDataJSON()).toEqual({ email: 'ana@example.org', password: 'mi contraseña' });
      authenticated = true;
      return route.fulfill({ json: session() });
    }
    throw new Error(`API inesperada: ${path}`);
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Mis préstamos', exact: true }).click();
  await expect(page).toHaveURL(/\/prestamos$/);
  await expect(page.getByRole('heading', { name: 'Mis préstamos', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mis préstamos', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Registrate', exact: true })).toHaveAttribute('href', '/registro');
  await expect(page.getByText('Estamos preparando esta sección.')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('loans-anonymous.png'), fullPage: true });

  const opener = page.getByRole('button', { name: 'Ingresar a mi cuenta', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/\/prestamos$/);
  await opener.click();
  await page.getByLabel('Correo electrónico', { exact: true }).fill('ana@example.org');
  await page.getByLabel('Contraseña', { exact: true }).fill('mi contraseña');
  await page.getByRole('dialog').getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Estamos preparando esta sección.')).toBeVisible();
  await expect(opener).toHaveCount(0);
  await expect(page).toHaveURL(/\/prestamos$/);
  await expect(page.getByText('Hola, Ana')).toBeVisible();
  const restored = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/session' && response.status() === 200);
  await page.reload();
  await restored;
  await expect(page.getByText('Estamos preparando esta sección.')).toBeVisible();
  await expect(page.getByText('Hola, Ana')).toBeVisible();
  await page.getByRole('link', { name: 'Saltar al contenido', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/\/prestamos$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('loans-authenticated.png'), fullPage: true });
  await page.getByRole('link', { name: 'Explorar catálogo', exact: true }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
});

test('la URL directa espera la sesión y permite recuperarse de un error de comprobación', async ({ page }) => {
  let fail = true;
  let resolveSession!: () => void;
  const waiting = new Promise<void>(resolve => { resolveSession = resolve; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/subjects') return route.fulfill({ json: { subjects: [] } });
    if (path !== '/api/auth/session') throw new Error('API inesperada');
    await waiting;
    return route.fulfill({ status: fail ? 503 : 200,
      json: fail ? { error: { code: 'SERVICE_UNAVAILABLE' } } : session() });
  });
  await page.goto('/prestamos?origen=directo');
  await expect(page.getByRole('progressbar', { name: 'Comprobando sesión' })).toBeVisible();
  await expect(page.getByText('Estamos preparando esta sección.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ingresar a mi cuenta', exact: true })).toHaveCount(0);
  resolveSession();
  await expect(page.getByText('Tu sesión todavía no está confirmada')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Reintentar sesión', exact: true }).click();
  await expect(page.getByText('Estamos preparando esta sección.')).toBeVisible();
  await expect(page).toHaveURL(/\/prestamos\?origen=directo$/);
});
