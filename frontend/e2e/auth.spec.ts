import { expect, test } from '@playwright/test';
import type { AuthResponse } from '../src/app/auth/auth.types';
import type { PersonalCirculation } from '../src/app/loans/loan-query.types';

const university = { id: '00000000-0000-4000-8000-000000000007', name: 'Facultad Regional Córdoba (Córdoba)' };
const password = ' con espacios ñ 漢字 ';
function response(): AuthResponse {
  const now = new Date();
  return {
    user: { id: 'usuario-e2e', firstName: 'Ana', lastName: 'Pérez', email: 'ana@bücher.de', university },
    session: { createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 21600000).toISOString() },
    serverTime: now.toISOString(),
  };
}

test('registro conserva password exacta, cookie y consulta de sesión al recargar', async ({ page }) => {
  let session: AuthResponse | null = null;
  let registrations = 0;
  // Solo fixtures de navegador: todas las llamadas API quedan interceptadas.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/universities') return route.fulfill({ json: { universities: [university] } });
    if (path === '/api/books') return route.fulfill({ json: { books: [] } });
    if (path === '/api/auth/session') return route.fulfill({ status: session ? 200 : 401, json: session ?? { error: { code: 'AUTH_REQUIRED' } } });
    if (path === '/api/auth/register') {
      registrations++;
      expect(route.request().headers()['x-biblioteca-request']).toBe('1');
      expect(route.request().postDataJSON()).toEqual({ firstName: 'Ana', lastName: 'Pérez', universityId: university.id, email: 'ana@bücher.de', password });
      session = response();
      return route.fulfill({ status: 201, headers: {
        'Cache-Control': 'no-store', 'Set-Cookie': `biblioteca_session=${'x'.repeat(43)}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(session.session.expiresAt).toUTCString()}`,
      }, json: session });
    }
    await route.abort();
    throw new Error(`API inesperada en la prueba: ${path}`);
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Crear mi cuenta', exact: true }).click();
  await expect(page).toHaveURL(/\/registro$/);
  await page.getByLabel('Nombre', { exact: true }).fill('Ana');
  await page.getByLabel('Apellido', { exact: true }).fill('Pérez');
  const select = page.getByRole('combobox');
  await select.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: university.name })).toBeVisible();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(select).toContainText(university.name);
  await page.getByLabel('Correo electrónico', { exact: true }).fill('ana@bücher.de');
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  // El navegador no debe convertir el dominio a punycode al perder foco.
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toHaveValue('ana@bücher.de');
  await page.locator('form').getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Hola, Ana')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Crear mi cuenta', exact: true })).toHaveCount(0);
  expect(registrations).toBe(1);
  const cookie = (await page.context().cookies()).find(item => item.name === 'biblioteca_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('biblioteca_session');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  const restored = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/session' && response.status() === 200);
  await page.reload();
  await restored;
  await expect(page.getByText('Hola, Ana')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('El conocimiento');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('login informa el error y luego autentica sin cambiar la página ni su contenido', async ({ page }) => {
  let logins = 0;
  let authenticated = false;
  let personalRequests = 0;
  const identity = response();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED' } } });
    if (path === '/api/books') return route.fulfill({ json: { books: [{ availability: { availableCopies: 1, totalCopies: 1 }, id: 'libro', title: 'Álgebra', authors: [], subjects: [] }] } });
    if (path === '/api/subjects') return route.fulfill({ json: { subjects: [] } });
    if (path === '/api/me/circulation') {
      expect(authenticated).toBe(true);
      expect(route.request().method()).toBe('GET');
      personalRequests++;
      return route.fulfill({ json: { serverTime: identity.serverTime, loans: [], waits: [], reservations: [],
        requestConstraints: { activeLoanCount: 0, maxActiveLoans: 5, openQueueBookIds: [] } } satisfies PersonalCirculation });
    }
    if (path === '/api/auth/login') {
      logins++;
      expect(route.request().headers()['x-biblioteca-request']).toBe('1');
      if (route.request().postDataJSON().password !== password) return route.fulfill({ status: 401, json: { error: { code: 'INVALID_CREDENTIALS' } } });
      authenticated = true;
      return route.fulfill({ json: identity });
    }
    await route.abort();
    throw new Error(`API inesperada en la prueba: ${path}`);
  });
  await page.goto('/catalogo?q=algebra');
  const article = await page.getByRole('article').elementHandle();
  expect(personalRequests).toBe(0);
  const opener = page.getByRole('button', { name: 'Ingresar', exact: true });
  await expect(opener).toBeEnabled(); await opener.click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toBeFocused();
  await page.getByLabel('Correo electrónico', { exact: true }).fill('ana@bücher.de');
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta');
  await dialog.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('incorrectos');
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Hola, Ana')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Solicitar préstamo de Álgebra', exact: true })).toBeEnabled();
  expect(personalRequests).toBe(1);
  await expect(page).toHaveURL(/\/catalogo\?q=algebra$/);
  expect(await article!.evaluate(element => element.isConnected)).toBe(true);
  expect(logins).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
