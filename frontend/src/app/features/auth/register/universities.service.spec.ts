import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UniversitiesService } from './universities.service';

describe('UniversitiesService', () => {
  let service: UniversitiesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(UniversitiesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta por GET y conserva los UUID y nombres recibidos', () => {
    const universities = [
      { id: '00000000-0000-4000-8000-000000000007', name: 'Facultad Regional Córdoba (Córdoba)' },
    ];
    const received = vi.fn();
    service.list().subscribe(received);
    const request = http.expectOne('/api/universities');
    expect(request.request.method).toBe('GET');
    expect(request.request.body).toBeNull();
    request.flush({ universities });
    expect(received).toHaveBeenCalledExactlyOnceWith(universities);
  });

  it('acepta una lista vacía', () => {
    const received = vi.fn();
    service.list().subscribe(received);
    http.expectOne('/api/universities').flush({ universities: [] });
    expect(received).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('propaga el fallo para que la página permita reintentar', () => {
    const failed = vi.fn();
    service.list().subscribe({ error: failed });
    http.expectOne('/api/universities').flush(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'No disponible.' } },
      { status: 503, statusText: 'Service Unavailable' },
    );
    expect(failed).toHaveBeenCalledOnce();
  });
});
