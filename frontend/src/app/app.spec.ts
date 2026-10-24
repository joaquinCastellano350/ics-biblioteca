import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { filter, firstValueFrom } from 'rxjs';
import { App } from './app';
import { routes } from './app.routes';
import { Register } from './features/auth/register/register';
import { AuthService } from './auth/auth.service';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let router: Router;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes), providePrimeNG({ unstyled: true }),
        provideHttpClient(), provideHttpClientTesting(),
      ],
    })
      .compileComponents();
    fixture = TestBed.createComponent(App);
    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    await navigate('/');
  });

  afterEach(() => http.verify());

  async function settleNavigation(): Promise<void> {
    fixture.detectChanges();
    for (const request of http.match('/api/books')) {
      expect(request.request.method).toBe('GET');
      request.flush({ books: [] });
    }
    for (const request of http.match('/api/universities')) {
      expect(request.request.method).toBe('GET');
      request.flush({ universities: [
        { id: '00000000-0000-4000-8000-000000000007', name: 'Facultad Regional Córdoba (Córdoba)' },
      ] });
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function navigate(url: string): Promise<void> {
    await router.navigateByUrl(url);
    await settleNavigation();
  }

  it('should create the app', () => {
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('muestra la landing en el inicio', async () => {
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(router.url).toBe('/');
    expect(compiled.querySelector('h1')?.textContent).toContain('El conocimiento');
  });

  it('mantiene el acceso de registro deshabilitado hasta la integración de cuentas', () => {
    const root = fixture.nativeElement as HTMLElement;
    const register = Array.from(root.querySelectorAll<HTMLButtonElement>('.account-actions button'))
      .find(button => button.textContent?.trim() === 'Crear cuenta');
    expect(register?.disabled).toBe(true);
    expect(root.querySelector('a[href="/registro"]')).toBeNull();
  });

  it('no navega al usar el acceso de registro pendiente', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const register = Array.from(root.querySelectorAll<HTMLButtonElement>('.account-actions button'))
      .find(button => button.textContent?.trim() === 'Crear cuenta');
    register!.click();
    await fixture.whenStable();
    expect(router.url).toBe('/');
    expect(root.querySelector('app-register-page')).toBeNull();
  });

  it('permite abrir /registro directamente y enviar datos válidos con facultades disponibles', async () => {
    await navigate('/registro');
    expect(fixture.nativeElement.querySelector('app-register-page')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Congratulations!');
    const register: Register = fixture.debugElement.query(By.directive(Register)).componentInstance;
    expect(register.universities()).toEqual([
      { id: '00000000-0000-4000-8000-000000000007', name: 'Facultad Regional Córdoba (Córdoba)' },
    ]);
    expect(register.submitDisabled()).toBe(false);
    register.submit();
    http.expectNone('/api/auth/register');

    const data = {
      firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.org', password: 'a',
      universityId: register.universities()[0].id,
    };
    register.form.setValue(data);
    expect(register.form.valid).toBe(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
    fixture.nativeElement.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    const request = http.expectOne('/api/auth/register');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-Biblioteca-Request')).toBe('1');
    expect(request.request.body).toEqual(data);
    expect(router.url).toBe('/registro');
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);

    const navigation = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationEnd)));
    request.flush({
      user: {
        id: '00000000-0000-4000-8000-000000000001', firstName: data.firstName,
        lastName: data.lastName, email: data.email, university: register.universities()[0],
      },
      session: { createdAt: '2026-10-22T12:00:00.000Z', expiresAt: '2026-10-22T18:00:00.000Z' },
      serverTime: '2026-10-22T12:00:00.000Z',
    }, { status: 201, statusText: 'Created' });
    await navigation;
    await settleNavigation();
    expect(router.url).toBe('/');
    expect(TestBed.inject(AuthService).status()).toBe('authenticated');
    expect(TestBed.inject(AuthService).ensureAuthenticated()).toBe(true);
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('El conocimiento');
    expect(fixture.nativeElement.querySelector('app-register')).toBeNull();
  });

  it('vuelve a la landing al usar Volver al inicio desde registro', async () => {
    await navigate('/registro');
    const navigation = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationEnd)));
    fixture.nativeElement.querySelector('app-register-page nav a').click();
    await navigation;
    await settleNavigation();
    expect(router.url).toBe('/');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('El conocimiento');
    expect(fixture.nativeElement.querySelector('app-register')).toBeNull();
  });

  it('conserva registro y landing aunque tengan query o fragmento', async () => {
    await navigate('/registro?origen=inicio#formulario');
    expect(fixture.nativeElement.textContent).not.toContain('Hello, biblioteca');
    await navigate('/?origen=registro#inicio');
    expect(router.url).toBe('/?origen=registro#inicio');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('El conocimiento');
    expect(fixture.nativeElement.querySelector('app-register')).toBeNull();
  });

  it('mantiene un enlace explícito al catálogo desde registro', async () => {
    await navigate('/registro');
    const navigation = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationEnd)));
    fixture.nativeElement.querySelector('nav[aria-label="Navegación principal"] a[href="/catalogo"]').click();
    await navigation;
    await settleNavigation();
    expect(router.url).toBe('/catalogo');
    expect(fixture.nativeElement.querySelector('app-catalog-page')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-register')).toBeNull();
  });

  it('mantiene el comodín después de las rutas públicas y redirige una ruta desconocida', async () => {
    await navigate('/ruta-inexistente');
    expect(router.url).toBe('/catalogo');
    expect(fixture.nativeElement.querySelector('app-catalog-page')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Catálogo de libros');
  });
});
