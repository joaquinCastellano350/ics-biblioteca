import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { filter, firstValueFrom } from 'rxjs';
import { App } from './app';
import { routes } from './app.routes';

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

  it('should render title', async () => {
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Hello, biblioteca');
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
    expect(fixture.nativeElement.textContent).toContain('Vista previa del formulario');
    expect(fixture.nativeElement.textContent).not.toContain('Hello, biblioteca');
  });

  it('permite abrir /registro directamente y mantiene bloqueado el envío', async () => {
    await navigate('/registro');
    expect(fixture.nativeElement.querySelector('app-register-page')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('Congratulations!');
  });

  it('restaura la bienvenida al usar Volver al inicio', async () => {
    await navigate('/registro');
    const navigation = firstValueFrom(router.events.pipe(filter((event) => event instanceof NavigationEnd)));
    fixture.nativeElement.querySelector('app-register-page nav a').click();
    await navigation;
    await settleNavigation();
    expect(router.url).toBe('/');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Hello, biblioteca');
    expect(fixture.nativeElement.querySelector('app-register')).toBeNull();
  });

  it('distingue la ruta inicial de registro aunque tengan query o fragmento', async () => {
    await navigate('/registro?origen=inicio#formulario');
    expect(fixture.nativeElement.textContent).not.toContain('Hello, biblioteca');
    await navigate('/?origen=registro#inicio');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Hello, biblioteca');
    expect(fixture.nativeElement.querySelector('app-register')).toBeNull();
  });
});
