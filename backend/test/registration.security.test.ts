import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/accounts/credentials.js';
import { newSessionToken as generateSessionToken, tokenHash as hashSessionToken } from '../src/accounts/sessions.js';

test('genera un hash Argon2id con los parámetros acordados y verifica la contraseña', async () => {
  const digest = await hashPassword('a');
  assert.match(digest, /^\$argon2id\$v=19\$/);
  assert.deepEqual(digest.split('$')[3]?.split(',').sort(), ['m=19456', 'p=1', 't=2']);
  assert.equal(await verifyPassword(digest, 'a'), true);
  assert.equal(await verifyPassword(digest, 'b'), false);
});

test('cada hash de la misma contraseña utiliza un salt distinto', async () => {
  const first = await hashPassword('a');
  const second = await hashPassword('a');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(first, 'a'), true);
  assert.equal(await verifyPassword(second, 'a'), true);
});

test('preserva espacios y Unicode al generar y verificar hashes', async () => {
  const digest = await hashPassword(' ñ漢字 ');
  assert.equal(await verifyPassword(digest, ' ñ漢字 '), true);
  assert.equal(await verifyPassword(digest, 'ñ漢字'), false);
  const whitespace = await hashPassword(' ');
  assert.equal(await verifyPassword(whitespace, ' '), true);
});

test('permite una contraseña de 1024 bytes', async () => {
  const password = 'ñ'.repeat(512);
  const digest = await hashPassword(password);
  assert.equal(await verifyPassword(digest, password), true);
});

test('rechaza contraseñas vacías o mayores a 1024 bytes sin incluirlas en el error', async () => {
  for (const password of ['', 'a'.repeat(1025), 'ñ'.repeat(513)]) {
    await assert.rejects(hashPassword(password), {
      name: 'TypeError', message: 'La contraseña debe ser no vacía y tener hasta 1024 bytes.',
    });
  }
});

test('no verifica contraseñas de tipo incorrecto, vacías o demasiado largas', async () => {
  const digest = await hashPassword('a');
  for (const password of [null, undefined, 42, [], {}, '', 'a'.repeat(1025)]) {
    assert.equal(await verifyPassword(digest, password), false);
  }
});

test('un digest corrupto produce un fallo interno en vez de credenciales incorrectas', async () => {
  await assert.rejects(verifyPassword('', 'a'));
  await assert.rejects(verifyPassword('digest-invalido', 'a'));
});

test('los tokens tienen 32 bytes, formato base64url y valores distintos', () => {
  const tokens = Array.from({ length: 32 }, () => generateSessionToken());
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    assert.equal(Buffer.from(token, 'base64url').toString('base64url'), token);
  }
});

test('el hash de token es determinista y hexadecimal de 64 caracteres', () => {
  const token = generateSessionToken();
  const digest = hashSessionToken(token);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(hashSessionToken(token), digest);
  assert.notEqual(digest, token);
  assert.notEqual(hashSessionToken('a'.repeat(43)), hashSessionToken('b'.repeat(43)));
});

test('rechaza tokens de formato inválido con un error genérico', () => {
  for (const token of ['', 'a'.repeat(42), 'a'.repeat(44), '+'.repeat(43), ' '.repeat(43)]) {
    assert.throws(() => hashSessionToken(token), {
      name: 'TypeError', message: 'El token de sesión tiene un formato inválido.',
    });
  }
});
