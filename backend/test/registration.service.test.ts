import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import {
  REGISTRATION_SESSION_DURATION_MS, RegistrationError, RegistrationPersistenceError, RegistrationService,
} from '../src/modules/accounts/registration.service.js';
import type {
  AtomicRegistrationInput, AtomicRegistrationResult, RegistrationErrorCode,
  RegistrationRepository,
} from '../src/modules/accounts/registration.service.js';
import { hashSessionToken, verifyPassword } from '../src/modules/accounts/registration.security.js';

const valid = {
  firstName: 'Ana', lastName: 'Pérez',
  universityId: '00000000-0000-4000-8000-000000000007',
  email: 'ana@example.org', password: 'a',
};

function persisted(input: AtomicRegistrationInput): AtomicRegistrationResult {
  const now = new Date('2026-10-22T12:00:00.123Z');
  return {
    user: {
      id: '12345678-1234-4234-8234-123456789abc',
      firstName: input.firstName, lastName: input.lastName, email: input.email,
      university: { id: input.universityId, name: 'Facultad Regional Córdoba (Córdoba)' },
    },
    session: { createdAt: now, expiresAt: new Date(now.getTime() + input.sessionDurationMs) },
    serverTime: now,
  };
}

function fakeRepository(
  operation: (input: AtomicRegistrationInput) => AtomicRegistrationResult | Promise<AtomicRegistrationResult> = persisted,
) {
  const calls: AtomicRegistrationInput[] = [];
  const repository: RegistrationRepository = {
    createUserAndSession: async (input) => {
      calls.push(input);
      return operation(input);
    },
  };
  return { repository, calls, service: new RegistrationService(repository) };
}

function hasCode(code: RegistrationErrorCode) {
  return (error: unknown): boolean => error instanceof RegistrationError && error.code === code;
}

test('registro exitoso: valida, normaliza e invoca una única operación atómica', async () => {
  const { service, calls } = fakeRepository();
  const result = await service.register({ ...valid, firstName: ' Ana ', lastName: ' Pérez ', email: ' ANA@EXAMPLE.ORG ' });
  assert.equal(calls.length, 1);
  const input = calls[0]!;
  assert.equal(input.firstName, valid.firstName);
  assert.equal(input.lastName, valid.lastName);
  assert.equal(input.email, valid.email);
  assert.equal(input.universityId, valid.universityId);
  assert.deepEqual(result.publicResponse.user, persisted(input).user);
  assert.equal(result.publicResponse.serverTime, '2026-10-22T12:00:00.123Z');
  assert.equal('password' in input, false);
  assert.equal('token' in input, false);
});

test('datos inválidos devuelven errores por campo sin invocar persistencia', async () => {
  const { service, calls } = fakeRepository();
  await assert.rejects(service.register({ ...valid, email: 'incorrecto', universityId: 'inválido', password: '' }),
    (error: unknown) => {
      assert.ok(error instanceof RegistrationError);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.deepEqual(Object.keys(error.fields!).sort(), ['email', 'password', 'universityId']);
      return true;
    });
  assert.equal(calls.length, 0);
});

test('una contraseña sencilla se acepta y se guarda como Argon2id, no en texto plano', async () => {
  const { service, calls } = fakeRepository();
  await service.register(valid);
  const digest = calls[0]!.passwordHash;
  assert.match(digest, /^\$argon2id\$/);
  assert.notEqual(digest, valid.password);
  assert.equal(await verifyPassword(digest, valid.password), true);
  assert.equal(await verifyPassword(digest, 'otra'), false);
});

test('preserva contraseña con espacios y Unicode al calcular el hash', async () => {
  const { service, calls } = fakeRepository();
  const password = ' ñ漢字 ';
  await service.register({ ...valid, password });
  assert.equal(await verifyPassword(calls[0]!.passwordHash, password), true);
  assert.equal(await verifyPassword(calls[0]!.passwordHash, password.trim()), false);
});

test('genera token de 32 bytes y envía únicamente su SHA-256 al repositorio', async () => {
  const { service, calls } = fakeRepository();
  const result = await service.register(valid);
  assert.match(result.cookie.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(result.cookie.token, 'base64url').length, 32);
  assert.equal(calls[0]!.tokenHash, hashSessionToken(result.cookie.token));
  assert.match(calls[0]!.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(calls[0]!.tokenHash, result.cookie.token);
});

test('solicita exactamente seis horas y devuelve fechas del repositorio, no del reloj local', async () => {
  const { service, calls } = fakeRepository();
  const result = await service.register(valid);
  assert.equal(REGISTRATION_SESSION_DURATION_MS, 21600000);
  assert.equal(calls[0]!.sessionDurationMs, 21600000);
  const dates = result.publicResponse.session;
  assert.equal(Date.parse(dates.expiresAt) - Date.parse(dates.createdAt), 21600000);
  assert.equal(dates.createdAt, '2026-10-22T12:00:00.123Z');
  assert.equal(dates.expiresAt, '2026-10-22T18:00:00.123Z');
  assert.equal(result.cookie.expiresAt.toISOString(), dates.expiresAt);
  assert.equal(result.cookie.maxAgeMs, 21600000);
});

test('la cookie nunca prolonga el tiempo restante de una sesión ya creada', async () => {
  const { service } = fakeRepository((input) => {
    const result = persisted(input);
    result.serverTime = new Date(result.serverTime.getTime() + 1000);
    return result;
  });
  const result = await service.register(valid);
  assert.equal(result.cookie.maxAgeMs, 21600000 - 1000);
});

test('la respuesta pública excluye token y hashes incluso si el adaptador agrega propiedades', async () => {
  let digest = '';
  let sessionHash = '';
  const { service } = fakeRepository((input) => {
    digest = input.passwordHash;
    sessionHash = input.tokenHash;
    const result = persisted(input);
    return {
      ...result,
      passwordHash: digest,
      user: {
        ...result.user, password: 'dato-privado-de-prueba', passwordHash: digest,
        university: { ...result.user.university, internal: 'interno' },
      },
      session: { ...result.session, tokenHash: sessionHash },
    };
  });
  const result = await service.register(valid);
  const json = JSON.stringify(result.publicResponse);
  for (const secret of [digest, sessionHash, result.cookie.token, 'dato-privado-de-prueba']) {
    assert.equal(json.includes(secret), false);
  }
  assert.deepEqual(Object.keys(result.publicResponse).sort(), ['serverTime', 'session', 'user']);
  assert.deepEqual(Object.keys(result.publicResponse.user).sort(), ['email', 'firstName', 'id', 'lastName', 'university']);
  assert.deepEqual(Object.keys(result.publicResponse.session).sort(), ['createdAt', 'expiresAt']);
  assert.deepEqual(Object.keys(result.publicResponse.user.university).sort(), ['id', 'name']);
});

test('facultad inexistente conserva un error tipado y señala universityId', async () => {
  const { service, calls } = fakeRepository(() => { throw new RegistrationPersistenceError('UNIVERSITY_NOT_FOUND'); });
  await assert.rejects(service.register(valid), (error: unknown) => {
    assert.ok(error instanceof RegistrationError);
    assert.equal(error.code, 'UNIVERSITY_NOT_FOUND');
    assert.equal(typeof error.fields?.universityId, 'string');
    return true;
  });
  assert.equal(calls.length, 1);
});

test('correo duplicado proviene de la operación atómica, sin consulta previa ni reintento', async () => {
  const { service, calls } = fakeRepository(() => { throw new RegistrationPersistenceError('EMAIL_ALREADY_REGISTERED'); });
  await assert.rejects(service.register(valid), (error: unknown) => {
    assert.ok(error instanceof RegistrationError);
    assert.equal(error.code, 'EMAIL_ALREADY_REGISTERED');
    assert.equal(typeof error.fields?.email, 'string');
    return true;
  });
  assert.equal(calls.length, 1);
});

test('dependencia no disponible se distingue de fallo interno', async () => {
  const { service, calls } = fakeRepository(() => { throw new RegistrationPersistenceError('DEPENDENCY_UNAVAILABLE'); });
  await assert.rejects(service.register(valid), hasCode('SERVICE_UNAVAILABLE'));
  assert.equal(calls.length, 1);
});

test('fallo inesperado se traduce sin exponer detalles, causa ni errores de infraestructura', async () => {
  const { service, calls } = fakeRepository(() => { throw new Error('detalle-privado-de-conexion'); });
  await assert.rejects(service.register(valid), (error: unknown) => {
    assert.ok(error instanceof RegistrationError);
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.equal(error.message, 'No se pudo completar el registro.');
    assert.equal('cause' in error, false);
    assert.equal(JSON.stringify(error).includes('detalle-privado-de-conexion'), false);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('no trata como error tipado un objeto ajeno con una propiedad code', async () => {
  const { service } = fakeRepository(() => { throw { code: 'EMAIL_ALREADY_REGISTERED', message: 'interno' }; });
  await assert.rejects(service.register(valid), hasCode('INTERNAL_ERROR'));
});

test('cada registro usa token y salt nuevos, con una operación por intento', async () => {
  const { service, calls } = fakeRepository();
  const first = await service.register(valid);
  const second = await service.register(valid);
  assert.equal(calls.length, 2);
  assert.notEqual(first.cookie.token, second.cookie.token);
  assert.notEqual(calls[0]!.tokenHash, calls[1]!.tokenHash);
  assert.notEqual(calls[0]!.passwordHash, calls[1]!.passwordHash);
});

test('rechaza una duración de sesión incoherente devuelta por el repositorio', async () => {
  const { service, calls } = fakeRepository((input) => {
    const result = persisted(input);
    result.session.expiresAt = new Date(result.session.createdAt.getTime() + 1000);
    return result;
  });
  await assert.rejects(service.register(valid), hasCode('INTERNAL_ERROR'));
  assert.equal(calls.length, 1);
});

test('rechaza fechas inválidas o una sesión que ya venció antes de informar éxito', async () => {
  for (const mode of ['invalid', 'expired', 'future'] as const) {
    const { service } = fakeRepository((input) => {
      const result = persisted(input);
      result.serverTime = mode === 'invalid' ? new Date('invalid')
        : mode === 'expired' ? new Date(result.session.expiresAt)
        : new Date(result.session.createdAt.getTime() - 1);
      return result;
    });
    await assert.rejects(service.register(valid), hasCode('INTERNAL_ERROR'));
  }
});
