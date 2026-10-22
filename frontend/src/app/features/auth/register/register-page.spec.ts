import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { Register } from './register';
import { RegisterPage } from './register-page';

describe('RegisterPage', () => {
  let fixture: ComponentFixture<RegisterPage>;
  let http: HttpTestingController;
  const universities = [
    { id: '00000000-0000-4000-8000-000000000007', name: 'Facultad Regional Córdoba (Córdoba)' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [
        provideRouter([]), providePrimeNG({ unstyled: true }),
        provideHttpClient(), provideHttpClientTesting(),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RegisterPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function completeLoad(): Register {
    const request = http.expectOne('/api/universities');
    expect(request.request.method).toBe('GET');
    request.flush({ universities });
    fixture.detectChanges();
    return fixture.debugElement.query(By.directive(Register)).componentInstance;
  }

  it('reutiliza el formulario y explica que no se crean cuentas', () => {
    completeLoad();
    expect(fixture.debugElement.query(By.directive(Register))).not.toBeNull();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('aside')?.textContent).toContain('Vista previa del formulario');
    expect(element.textContent).toContain('El registro de cuentas todavía no está habilitado.');
    expect(element.textContent).toContain('no se enviarán tus datos de registro ni se creará una cuenta.');
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

  it('muestra las opciones recibidas y deja los campos editables, pero no el envío', () => {
    const register = completeLoad();
    expect(register.universities()).toEqual(universities);
    expect(register.universitiesLoading()).toBe(false);
    expect(register.universitiesError()).toBeNull();
    expect(register.submitDisabled()).toBe(true);
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    expect(select.options.length).toBe(2);
    expect(select.options[1].value).toBe(universities[0].id);
    expect(select.options[1].textContent).toContain(universities[0].name);
    expect(select.matches(':disabled')).toBe(false);
    expect(fixture.nativeElement.querySelector('fieldset').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
  });

  it('no emite una solicitud aunque se fuerce el evento submit', () => {
    const register = completeLoad();
    register.form.setValue({
      firstName: 'Ana', lastName: 'Pérez', universityId: universities[0].id,
      email: 'ana@example.org', password: 'a',
    });
    expect(register.form.valid).toBe(true);
    const emitted = vi.fn();
    register.registerRequested.subscribe(emitted);
    fixture.nativeElement.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Vista previa del formulario');
    http.expectNone((request) => request.method !== 'GET');
  });

  it('presenta error y permite recuperar las opciones mediante reintento manual', () => {
    http.expectOne('/api/universities').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar las facultades.');
    fixture.nativeElement.querySelector('.retry-button').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.universitiesError()).toBeNull();
    expect(fixture.componentInstance.universitiesLoading()).toBe(true);
    expect(fixture.nativeElement.querySelector('.retry-button')).toBeNull();
    completeLoad();
    expect(fixture.componentInstance.universities()).toEqual(universities);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
  });

  it('distingue lista vacía de error y permite volver a consultar', () => {
    http.expectOne('/api/universities').flush({ universities: [] });
    fixture.detectChanges();
    expect(fixture.componentInstance.universitiesError()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No hay facultades disponibles.');
    const retry: HTMLButtonElement = fixture.nativeElement.querySelector('.retry-button');
    expect(retry.textContent).toContain('Volver a consultar facultades');
    retry.click();
    fixture.detectChanges();
    completeLoad();
  });

  it('cancela la solicitud pendiente cuando se destruye la página', () => {
    const request = http.expectOne('/api/universities');
    fixture.destroy();
    expect(request.cancelled).toBe(true);
  });
});
