import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRegistration } from '../src/accounts/registration.validation.js';
import { validPassword as isValidRegistrationPassword, MAX_PASSWORD_BYTES, normalizeEmail } from '../src/accounts/credentials.js';

const valid = {
  firstName: 'Ana', lastName: 'Pérez',
  universityId: '00000000-0000-4000-8000-000000000007',
  email: 'ana@example.org', password: 'a',
};

test('valida los cinco campos y normaliza sin mutar la entrada', () => {
  const input = Object.freeze({
    ...valid, firstName: '  Ana María  ', lastName: '  Pérez López ',
    email: '  ANA@EXAMPLE.ORG ', password: ' a ',
    universityId: ' E97A9343-B62E-425C-A47B-915AD13825B1 ',
  });
  assert.deepEqual(validateRegistration(input), {
    valid: true,
    data: {
      ...valid, firstName: 'Ana María', lastName: 'Pérez López', password: ' a ',
      universityId: 'e97a9343-b62e-425c-a47b-915ad13825b1',
    },
  });
  assert.equal(input.email, '  ANA@EXAMPLE.ORG ');
});

test('normaliza solo espacios exteriores y mayúsculas del correo', () => {
  assert.equal(normalizeEmail('  ANA+libros@Example.ORG\t'), 'ana+libros@example.org');
  assert.equal(normalizeEmail('ana perez@example.org'), 'ana perez@example.org');
  assert.equal(validateRegistration({ ...valid, email: 'ana perez@example.org' }).valid, false);
});

test('acepta diferentes dominios sin exigir correo institucional', () => {
  for (const email of ['ana@gmail.com', 'ana@example.org', 'ana@universidad.edu.ar']) {
    assert.equal(validateRegistration({ ...valid, email }).valid, true);
  }
});

test('acepta nombres internacionales, apóstrofes y guiones sin reglas no documentadas', () => {
  assert.equal(validateRegistration({ ...valid, firstName: '李', lastName: "O'Connor-García" }).valid, true);
});

test('rechaza campos ausentes, vacíos, espacios en nombres y tipos incorrectos', () => {
  for (const field of Object.keys(valid) as Array<keyof typeof valid>) {
    for (const value of [undefined, null, '', 42, false, [], {}]) {
      const result = validateRegistration({ ...valid, [field]: value });
      assert.equal(result.valid, false);
      if (!result.valid) assert.equal(typeof result.fields[field], 'string');
    }
  }
  for (const field of ['firstName', 'lastName', 'email', 'universityId'] as const) {
    assert.equal(validateRegistration({ ...valid, [field]: ' \t\n' }).valid, false);
  }
});

test('rechaza cuerpos que no representan datos de registro', () => {
  for (const input of [undefined, null, [], 'texto', 1, true]) {
    const result = validateRegistration(input);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(Object.keys(result.fields).length, 5);
  }
});

test('rechaza UUID mal formado y correo inválido', () => {
  for (const universityId of ['no-es-uuid', '7', '00000000-0000-4000-8000-00000000000Z']) {
    assert.equal(validateRegistration({ ...valid, universityId }).valid, false);
  }
  for (const email of ['ana', 'ana@', '@example.org', 'ana@example..org']) {
    assert.equal(validateRegistration({ ...valid, email }).valid, false);
  }
});

test('el formato UUID válido no implica comprobar existencia en una base', () => {
  assert.equal(validateRegistration({
    ...valid, universityId: '12345678-1234-4234-8234-123456789abc',
  }).valid, true);
});

test('contraseña no vacía sin complejidad y conservada exactamente', () => {
  for (const password of ['a', '1', ' ', ' clave ', 'ñ漢字']) {
    const result = validateRegistration({ ...valid, password });
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.data.password, password);
  }
});

test('acepta 1024 bytes y rechaza 1025; cuenta bytes UTF-8, no caracteres', () => {
  assert.equal(MAX_PASSWORD_BYTES, 1024);
  for (const password of ['a'.repeat(1024), 'ñ'.repeat(512), '😀'.repeat(256)]) {
    assert.equal(isValidRegistrationPassword(password), true);
    assert.equal(validateRegistration({ ...valid, password }).valid, true);
  }
  for (const password of ['a'.repeat(1025), 'ñ'.repeat(512) + 'a', '😀'.repeat(256) + 'a']) {
    assert.equal(isValidRegistrationPassword(password), false);
    assert.equal(validateRegistration({ ...valid, password }).valid, false);
  }
});

test('los errores no repiten valores recibidos ni devuelven datos parciales', () => {
  const result = validateRegistration({ ...valid, email: 'correo-invalido-privado', password: '' });
  assert.equal(result.valid, false);
  assert.equal('data' in result, false);
  assert.equal(JSON.stringify(result).includes('correo-invalido-privado'), false);
  assert.equal(JSON.stringify(result).includes(valid.firstName), false);
});
