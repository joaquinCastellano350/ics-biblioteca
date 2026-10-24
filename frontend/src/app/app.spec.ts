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

  it('redirige el inicio al catálogo público y muestra su título', async () => {
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(router.url).toBe('/catalogo');
    expect(compiled.querySelector('h1')?.textContent).toContain('Catálogo de libros');
  });

  it('ofrece un enlace al registro desde el inicio', () => {
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a[href="/registro"]');
    expect(link.textContent).toContain('Crear cuenta');
  });

  it('navega a la página pública de registro al usar Crear cuenta', async () => {
    const navigation = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationEnd)));
    fixture.nativeElement.querySelector('a[href="/registro"]').click();
    await navigation;
    await settleNavigation();
    expect(router.url).toBe('/registro');
    expect(fixture.nativeElement.querySelector('app-register-page')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-register')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-register h1')?.textContent).toContain('Creá tu cuenta');
    expect(fixture.nativeElement.textContent).not.toContain('Vista previa del formulario');
    expect(fixture.nativeElement.textContent).not.toContain('Hello, biblioteca');
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
    expect(router.url).toBe('/catalogo');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Catálogo de libros');
    expect(fixture.nativeElement.querySelector('app-register')).toBeNull();
  });

  it('vuelve al catálogo al usar Volver al inicio desde registro', async () => {
    await navigate('/registro');
    const navigation = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationEnd)));
    fixture.nativeElement.querySelector('app-register-page nav a').click();
    await navigation;
    await settleNavigation();
    expect(router.url).toBe('/catalogo');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Catálogo de libros');
    expect(fixture.nativeElement.querySelector('app-register')).toBeNull();
  });

  it('conserva registro y el inicio redirigido aunque tengan query o fragmento', async () => {
    await navigate('/registro?origen=inicio#formulario');
    expect(fixture.nativeElement.textContent).not.toContain('Hello, biblioteca');
    await navigate('/?origen=registro#inicio');
    expect(router.url).toContain('/catalogo');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Catálogo de libros');
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
