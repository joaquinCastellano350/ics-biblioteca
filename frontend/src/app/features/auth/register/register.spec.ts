import { ComponentFixture, TestBed } from '@angular/core/testing';
import { providePrimeNG } from 'primeng/config';
import { Register, RegistrationRequest, RegistrationUniversity } from './register';

describe('Register', () => {
  let fixture: ComponentFixture<Register>;
  let component: Register;
  const universities: RegistrationUniversity[] = [
    { id: 'e97a9343-b62e-425c-a47b-915ad13825b1', name: 'Facultad Regional Córdoba (Córdoba)' },
    { id: '10a7d374-1ff6-4bee-a20e-b62b178bb6b8', name: 'Facultad Regional Rosario (Santa Fe)' },
  ];
  const validRequest: RegistrationRequest = {
    firstName: 'Ana',
    lastName: 'Pérez',
    universityId: universities[0].id,
    email: 'ana@example.org',
    password: 'a',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [providePrimeNG({ unstyled: true })],
    }).compileComponents();
    fixture = TestBed.createComponent(Register);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('universities', universities);
    fixture.detectChanges();
  });

  function submitForm(): void {
    fixture.nativeElement.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  }

  it('muestra los cinco campos y las facultades recibidas', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('[formControlName]').length).toBe(5);
    const options = element.querySelectorAll('select option');
    expect(options.length).toBe(3);
    expect(options[1].textContent).toContain(universities[0].name);
    expect(options[2].textContent).toContain(universities[1].name);
    expect(element.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('muestra mensajes en español y no emite si faltan datos', () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    submitForm();
    expect(emitted).not.toHaveBeenCalled();
    for (const field of Object.values(component.form.controls)) {
      expect(field.hasError('required')).toBe(true);
      expect(field.touched).toBe(true);
    }
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ingresá tu nombre.');
    expect(text).toContain('Ingresá tu apellido.');
    expect(text).toContain('Seleccioná tu facultad.');
    expect(text).toContain('Ingresá tu correo electrónico.');
    expect(text).toContain('Ingresá una contraseña.');
  });

  it('rechaza nombres compuestos únicamente por espacios', () => {
    component.form.setValue({ ...validRequest, firstName: '  ', lastName: '  ' });
    expect(component.form.controls.firstName.hasError('required')).toBe(true);
    expect(component.form.controls.lastName.hasError('required')).toBe(true);
  });

  it('rechaza un correo inválido sin emitir', () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    component.form.setValue({ ...validRequest, email: 'correo-invalido' });
    submitForm();
    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Ingresá un correo electrónico válido.');
  });

  it.each(['ana@example.org', 'ana@gmail.com', 'ana@universidad.edu.ar'])(
    'acepta el correo %s y una contraseña sencilla, sin confirmación', (email) => {
      component.form.setValue({ ...validRequest, email });
      expect(component.form.valid).toBe(true);
    },
  );

  it('emite el contrato válido y conserva exactamente la contraseña', () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    component.form.setValue({
      ...validRequest, firstName: ' Ana ', lastName: ' Pérez ', password: ' a ',
    });
    submitForm();
    expect(emitted).toHaveBeenCalledExactlyOnceWith({ ...validRequest, password: ' a ' });
  });

  it('recoge cambios desde los controles HTML', () => {
    const element: HTMLElement = fixture.nativeElement;
    for (const field of ['firstName', 'lastName', 'email', 'password'] as const) {
      const input = element.querySelector<HTMLInputElement>(`[formControlName="${field}"]`)!;
      input.value = validRequest[field];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const select = element.querySelector('select')!;
    select.value = validRequest.universityId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(component.form.getRawValue()).toEqual(validRequest);
    expect(component.form.valid).toBe(true);
  });

  it('rechaza una facultad que no pertenece a las opciones recibidas', () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    component.form.setValue({ ...validRequest, universityId: 'otra-facultad' });
    submitForm();
    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Seleccioná una facultad de la lista.');
  });

  it('revalida la selección cuando cambian las opciones externas', () => {
    component.form.setValue(validRequest);
    fixture.componentRef.setInput('universities', [universities[1]]);
    fixture.detectChanges();
    expect(component.form.controls.universityId.hasError('unknownUniversity')).toBe(true);
    fixture.componentRef.setInput('universities', universities);
    fixture.detectChanges();
    expect(component.form.valid).toBe(true);
  });

  it('muestra errores externos generales y por campo como texto', () => {
    fixture.componentRef.setInput('errorMessage', 'No se pudo completar el registro.');
    fixture.componentRef.setInput('fieldErrors', { email: 'El correo ya está registrado.' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('No se pudo completar el registro.');
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#register-email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('El correo ya está registrado.');
    fixture.componentRef.setInput('fieldErrors', {});
    fixture.componentRef.setInput('errorMessage', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('submitDisabled bloquea el botón y cualquier envío sin bloquear los campos', () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    component.form.setValue(validRequest);
    fixture.componentRef.setInput('submitDisabled', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('fieldset').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('input').matches(':disabled')).toBe(false);
    expect(fixture.nativeElement.querySelector('select').matches(':disabled')).toBe(false);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    submitForm();
    component.submit();
    expect(emitted).not.toHaveBeenCalled();
    fixture.componentRef.setInput('submitDisabled', false);
    fixture.detectChanges();
    submitForm();
    expect(emitted).toHaveBeenCalledExactlyOnceWith(validRequest);
  });

  it('conserva el envío habilitado de forma predeterminada para datos válidos', () => {
    component.form.setValue(validRequest);
    fixture.detectChanges();
    expect(component.submitDisabled()).toBe(false);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
  });

  it('bloquea el envío y los campos mientras se registra', () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    component.form.setValue(validRequest);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    submitForm();
    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('fieldset').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Creando cuenta…');
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    submitForm();
    expect(emitted).toHaveBeenCalledOnce();
  });

  it('muestra carga de facultades sin permitir enviar datos', () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    component.form.setValue(validRequest);
    fixture.componentRef.setInput('universitiesLoading', true);
    fixture.detectChanges();
    submitForm();
    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Cargando facultades…');
  });

  it('bloquea el envío sin facultades o si su carga falló', () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    component.form.setValue(validRequest);
    fixture.componentRef.setInput('universitiesError', 'No se pudieron cargar las facultades.');
    fixture.detectChanges();
    submitForm();
    expect(fixture.nativeElement.textContent).toContain('No se pudieron cargar las facultades.');
    expect(emitted).not.toHaveBeenCalled();
    fixture.componentRef.setInput('universitiesError', null);
    fixture.componentRef.setInput('universities', []);
    fixture.detectChanges();
    submitForm();
    expect(fixture.nativeElement.textContent).toContain('No hay facultades disponibles.');
    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
  });
});
