import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { Register } from './register';
import { RegisterPage } from './register-page';

describe('RegisterPage', () => {
  let fixture: ComponentFixture<RegisterPage>;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;
  const universities = [
    { id: '00000000-0000-4000-8000-000000000007', name: 'Facultad Regional Córdoba (Córdoba)' },
  ];
  const data = {
    firstName: 'Ana', lastName: 'Pérez', universityId: universities[0].id,
    email: 'ana@example.org', password: ' a ',
  };

  function successResponse() {
    return {
      user: {
        id: '00000000-0000-4000-8000-000000000001', firstName: 'Ana', lastName: 'Pérez',
        email: data.email, university: universities[0],
      },
      session: { createdAt: '2026-10-22T12:00:00.000Z', expiresAt: '2026-10-22T18:00:00.000Z' },
      serverTime: '2026-10-22T12:00:00.000Z',
    };
  }

  beforeEach(async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    await TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [
        provideRouter([]), providePrimeNG({ unstyled: true }),
        provideHttpClient(), provideHttpClientTesting(),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RegisterPage);
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  });

  afterEach(() => { http.verify(); fixture?.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function completeLoad(): Register {
    const request = http.expectOne('/api/universities');
    expect(request.request.method).toBe('GET');
    request.flush({ universities });
    fixture.detectChanges();
    return fixture.debugElement.query(By.directive(Register)).componentInstance;
  }

  function fillAndSubmit(): Register {
    const register = completeLoad();
    register.form.setValue(data);
    fixture.nativeElement.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    return register;
  }

  it('reutiliza el formulario sin presentar el registro como vista previa', () => {
    completeLoad();
    expect(fixture.debugElement.query(By.directive(Register))).not.toBeNull();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).not.toContain('Vista previa del formulario');
    expect(element.textContent).not.toContain('El registro de cuentas todavía no está habilitado.');
    expect(element.querySelectorAll('[formControlName]').length).toBe(5);
  });

  it('permite volver al inicio mediante un enlace', () => {
    completeLoad();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('nav a');
    expect(link.textContent).toContain('Volver al inicio');
    expect(link.getAttribute('href')).toBe('/');
  });

  it('muestra carga sin iniciar otra solicitud simultánea', () => {
    const register: Register = fixture.debugElement.query(By.directive(Register)).componentInstance;
    expect(register.universities()).toEqual([]);
    expect(register.universitiesLoading()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Cargando facultades…');
    fixture.componentInstance.loadUniversities();
    fixture.componentInstance.loadUniversities();
    completeLoad(); // expectOne también detecta solicitudes duplicadas.
  });

  it('muestra las opciones recibidas y permite seleccionar su UUID en el formulario', async () => {
    const register = completeLoad();
    expect(register.universities()).toEqual(universities);
    expect(register.universitiesLoading()).toBe(false);
    expect(register.universitiesError()).toBeNull();
    expect(register.submitDisabled()).toBe(false);
    const select: HTMLElement = fixture.nativeElement.querySelector('[role="combobox"]');
    expect(select.getAttribute('aria-disabled')).toBe('false');
    select.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const options = document.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain(universities[0].name);
    options[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(register.form.controls.universityId.value).toBe(universities[0].id);
    expect(fixture.nativeElement.querySelector('fieldset').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
  });

  it('envía el formulario válido y navega únicamente después de recibir éxito', () => {
    const register = completeLoad();
    register.form.setValue({
      firstName: 'Ana', lastName: 'Pérez', universityId: universities[0].id,
      email: 'ana@example.org', password: 'a',
    });
    expect(register.form.valid).toBe(true);
    fixture.nativeElement.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    const request = http.expectOne('/api/auth/register');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(register.form.getRawValue());
    expect(navigate).not.toHaveBeenCalled();
    expect(register.loading()).toBe(true);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Creando cuenta');
    request.flush(successResponse(), { status: 201, statusText: 'Created' });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(['/']);
  });

  it('presenta error y permite recuperar las opciones mediante reintento manual', () => {
    http.expectOne('/api/universities').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar las facultades.');
    const retry: HTMLButtonElement = fixture.nativeElement.querySelector('.retry-button button');
    expect(retry.type).toBe('button');
    expect(retry.disabled).toBe(false);
    retry.focus();
    expect(document.activeElement).toBe(retry);
    retry.click();
    retry.click(); // Antes de quitarlo del DOM, el guard debe impedir otro GET.
    http.expectNone('/api/auth/register');
    fixture.detectChanges();
    expect(fixture.componentInstance.universitiesError()).toBeNull();
    expect(fixture.componentInstance.universitiesLoading()).toBe(true);
    expect(fixture.nativeElement.querySelector('.retry-button')).toBeNull();
    completeLoad();
    expect(fixture.componentInstance.universities()).toEqual(universities);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
  });

  it('distingue lista vacía de error y permite volver a consultar', () => {
    http.expectOne('/api/universities').flush({ universities: [] });
    fixture.detectChanges();
    expect(fixture.componentInstance.universitiesError()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No hay facultades disponibles.');
    const retry: HTMLButtonElement = fixture.nativeElement.querySelector('.retry-button button');
    expect(retry.type).toBe('button');
    expect(retry.textContent).toContain('Volver a consultar facultades');
    retry.click();
    retry.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.retry-button')).toBeNull();
    http.expectNone('/api/auth/register');
    completeLoad();
  });

  it('cancela la solicitud pendiente cuando se destruye la página', () => {
    const request = http.expectOne('/api/universities');
    fixture.destroy();
    expect(request.cancelled).toBe(true);
  });

  it('no envía un formulario inválido', () => {
    const register = completeLoad();
    register.submit();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Ingresá tu nombre.');
    http.expectNone('/api/auth/register');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('evita POST simultáneos aunque se fuerce el evento del hijo o el método del contenedor', () => {
    const register = fillAndSubmit();
    register.submit();
    register.registerRequested.emit(data);
    fixture.componentInstance.register(data);
    const request = http.expectOne('/api/auth/register');
    request.flush(successResponse(), { status: 201, statusText: 'Created' });
    fixture.detectChanges();
    register.registerRequested.emit(data);
    http.expectNone('/api/auth/register');
    expect(register.submitDisabled()).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('muestra validaciones HTTP 400 junto a sus campos sin perder valores ni navegar', () => {
    const register = fillAndSubmit();
    const fields = {
      firstName: 'Revisá el nombre.', universityId: 'Seleccioná una facultad existente.',
      password: 'La contraseña supera el límite permitido.',
    };
    http.expectOne('/api/auth/register').flush(
      { error: { code: 'VALIDATION_ERROR', message: 'Mensaje interno no mostrar.', fields } },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(register.fieldErrors()).toEqual(fields);
    for (const message of Object.values(fields)) expect(fixture.nativeElement.textContent).toContain(message);
    expect(fixture.nativeElement.textContent).toContain('Revisá los datos ingresados.');
    expect(fixture.nativeElement.textContent).not.toContain('Mensaje interno no mostrar.');
    expect(register.form.getRawValue()).toEqual(data);
    expect(fixture.nativeElement.querySelector('input[type="password"]').value).toBe(data.password);
    expect(register.loading()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('limita las validaciones externas a campos conocidos y mensajes de texto', () => {
    const register = fillAndSubmit();
    http.expectOne('/api/auth/register').flush({ error: { fields: {
      email: 'Correo inválido.', password: { internal: 'no mostrar' }, token: 'no mostrar',
    } } }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(register.fieldErrors()).toEqual({ email: 'Correo inválido.' });
  });

  it('un 400 sin errores por campo muestra un mensaje general y permite reintentar', () => {
    const register = fillAndSubmit();
    http.expectOne('/api/auth/register').flush(null, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(register.fieldErrors()).toEqual({});
    expect(register.errorMessage()).toBe('Revisá los datos ingresados.');
    expect(register.form.getRawValue()).toEqual(data);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('muestra correo ocupado para HTTP 409 y limpia los errores al reintentar', () => {
    const register = fillAndSubmit();
    http.expectOne('/api/auth/register').flush(
      { error: { code: 'EMAIL_ALREADY_REGISTERED' } }, { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#register-email-error').textContent)
      .toContain('El correo electrónico ya está registrado.');
    expect(register.form.getRawValue()).toEqual(data);
    expect(navigate).not.toHaveBeenCalled();
    register.form.controls.email.setValue('otro@example.org');
    register.submit();
    fixture.detectChanges();
    expect(register.fieldErrors()).toEqual({});
    expect(register.errorMessage()).toBeNull();
    const retry = http.expectOne('/api/auth/register');
    expect(retry.request.body.email).toBe('otro@example.org');
    retry.flush(successResponse(), { status: 201, statusText: 'Created' });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(['/']);
  });

  for (const status of [500, 503]) {
    it(`HTTP ${status} muestra un error general sin perder datos, navegar ni reintentar automáticamente`, () => {
      const register = fillAndSubmit();
      http.expectOne('/api/auth/register').flush(
        { error: { message: 'Información interna no mostrar.' } }, { status, statusText: 'Server Error' },
      );
      fixture.detectChanges();
      expect(register.errorMessage()).toBe('No se pudo completar el registro. Intentá nuevamente más tarde.');
      expect(fixture.nativeElement.textContent).not.toContain('Información interna no mostrar.');
      expect(register.loading()).toBe(false);
      expect(register.form.getRawValue()).toEqual(data);
      expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      http.expectNone('/api/auth/register');
      expect(fixture.componentInstance.universities()).toEqual(universities);
    });
  }

  it('error de conexión conserva los datos y permite reintentar manualmente', () => {
    const register = fillAndSubmit();
    http.expectOne('/api/auth/register').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se pudo conectar con el servidor. Intentá nuevamente.');
    expect(register.form.getRawValue()).toEqual(data);
    expect(navigate).not.toHaveBeenCalled();
    register.submit();
    http.expectOne('/api/auth/register').flush(successResponse(), { status: 201, statusText: 'Created' });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(['/']);
  });

  it('cancela el POST pendiente al destruir la página y no navega', () => {
    fillAndSubmit();
    const request = http.expectOne('/api/auth/register');
    fixture.destroy();
    expect(request.cancelled).toBe(true);
    expect(fixture.componentInstance.submitting()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('no inicia registro durante la carga, ante error o con lista vacía de facultades', () => {
    fixture.componentInstance.register(data);
    http.expectNone('/api/auth/register');
    http.expectOne('/api/universities').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.componentInstance.register(data);
    http.expectNone('/api/auth/register');
    fixture.componentInstance.loadUniversities();
    http.expectOne('/api/universities').flush({ universities: [] });
    fixture.componentInstance.register(data);
    http.expectNone('/api/auth/register');
    expect(navigate).not.toHaveBeenCalled();
  });
});
