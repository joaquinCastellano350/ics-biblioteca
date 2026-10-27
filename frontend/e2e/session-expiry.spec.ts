import { expect, test } from '@playwright/test';
import type { AuthResponse } from '../src/app/auth/auth.types';

test('al vencer retira la identidad y el espacio personal; permite ingresar de nuevo sin navegar', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
  const initial: AuthResponse = {
    user: { id: 'estudiante', firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org',
      university: { id: 'universidad', name: 'Universidad' } },
    session: { createdAt: '2026-10-25T12:00:00Z', expiresAt: '2026-10-25T18:00:00Z' },
    serverTime: '2026-10-25T12:00:00Z',
  };
  let logins = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: initial });
    if (path === '/api/auth/login') {
      logins++;
      expect(route.request().postDataJSON()).toEqual({ email: 'ana@example.org', password: 'mi contraseña' });
      return route.fulfill({ json: { ...initial,
        session: { createdAt: '2026-10-25T18:00:00Z', expiresAt: '2026-10-26T00:00:00Z' },
        serverTime: '2026-10-25T18:00:00Z',
      } });
    }
    throw new Error(`API inesperada: ${path}`);
  });
  await page.goto('/prestamos?origen=sesion#contenido');
  await expect(page.getByText('Hola, Ana')).toBeVisible();
  await expect(page.getByText('Estamos preparando esta sección.')).toBeVisible();
  await page.clock.fastForward(6 * 60 * 60 * 1000);
  await expect(page.getByText('Hola, Ana')).toHaveCount(0);
  await expect(page.getByText('Estamos preparando esta sección.')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/prestamos\?origen=sesion#contenido$/);
  const opener = page.getByRole('button', { name: 'Ingresar a mi cuenta', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(logins).toBe(0);
  await opener.click();
  await page.getByLabel('Correo electrónico', { exact: true }).fill('ana@example.org');
  await page.getByLabel('Contraseña', { exact: true }).fill('mi contraseña');
  await page.getByRole('dialog').getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Hola, Ana')).toBeVisible();
  await expect(page.getByText('Estamos preparando esta sección.')).toBeVisible();
  await expect(page).toHaveURL(/\/prestamos\?origen=sesion#contenido$/);
  expect(logins).toBe(1);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reauthenticated.png'), fullPage: true });
});
