import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { providePrimeNG } from 'primeng/config';
import { InputText } from 'primeng/inputtext';
import { Register, RegistrationRequest, RegistrationUniversity } from './register';

describe('Register', () => {
  it.each(['ana@bücher.de', 'iñaki@example.org', '\u00a0Ana@Example.org\u00a0'])(
    'acepta el correo que admite la API y normaliza espacios exteriores: %s', (email) => {
      component.form.setValue({ ...validRequest, email });
      const emitted = vi.fn(); component.registerRequested.subscribe(emitted);
      submitForm();
      expect(component.form.valid).toBe(true);
      expect(emitted).toHaveBeenCalledWith({ ...validRequest, email: email.trim().toLowerCase() });
    },
  );

  it('rechaza el correo quoted con espacios antes del POST', () => {
    component.form.setValue({ ...validRequest, email: '"ana test"@example.org' });
    expect(component.form.controls.email.hasError('email')).toBe(true);
  });
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
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    await TestBed.configureTestingModule({
      imports: [Register],
      providers: [providePrimeNG({ unstyled: true })],
    }).compileComponents();
    fixture = TestBed.createComponent(Register);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('universities', universities);
    fixture.detectChanges();
  });

  afterEach(() => { fixture?.destroy(); vi.unstubAllGlobals(); });

  function submitForm(): void {
    fixture.nativeElement.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  }

  function combobox(): HTMLElement {
    return fixture.nativeElement.querySelector('[role="combobox"]');
  }

  function inputInvalid(id: string): boolean | undefined {
    // La suite usa unstyled: se comprueba la API real, sin depender de clases CSS.
    return fixture.debugElement.query(By.css(`#${id}`)).injector.get(InputText).invalid();
  }

  async function openUniversities(): Promise<HTMLElement[]> {
    combobox().focus();
    combobox().click();
    fixture.detectChanges();
    await fixture.whenStable();
    return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  }

  it('muestra los cinco campos y abre las facultades recibidas fuera del layout', async () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('[formControlName]').length).toBe(5);
    expect(combobox().textContent).toContain('Seleccioná tu facultad');
    const options = await openUniversities();
    expect(combobox().getAttribute('aria-expanded')).toBe('true');
    expect(options.length).toBe(2);
    expect(options[0].textContent).toContain(universities[0].name);
    expect(options[1].textContent).toContain(universities[1].name);
    const listbox = document.getElementById(combobox().getAttribute('aria-controls')!);
    expect(listbox).not.toBeNull();
    await vi.waitFor(() => expect(element.contains(listbox)).toBe(false));
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

  it('recoge cambios reales desde los inputs y emite el UUID elegido en p-select', async () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    const element: HTMLElement = fixture.nativeElement;
    for (const field of ['firstName', 'lastName', 'email', 'password'] as const) {
      const input = element.querySelector<HTMLInputElement>(`[formControlName="${field}"]`)!;
      input.value = validRequest[field];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const options = await openUniversities();
    options[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.form.getRawValue()).toEqual(validRequest);
    expect(component.form.valid).toBe(true);
    expect(combobox().textContent).toContain(universities[0].name);
    submitForm();
    expect(emitted).toHaveBeenCalledExactlyOnceWith(validRequest);
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
    expect(inputInvalid('register-email')).toBe(true);
    expect(input.getAttribute('aria-describedby')).toContain('register-email-error');
    const fieldMessage: HTMLElement = fixture.nativeElement.querySelector('#register-email-error');
    expect(fieldMessage.tagName.toLowerCase()).toBe('p-message');
    expect(fieldMessage.getAttribute('role')).toBe('none');
    expect(fieldMessage.getAttribute('aria-live')).toBe('off');
    expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('El correo ya está registrado.');
    fixture.componentRef.setInput('fieldErrors', {});
    fixture.componentRef.setInput('errorMessage', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(inputInvalid('register-email')).toBe(false);
    expect(fixture.nativeElement.querySelector('#register-email-error')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe('register-email-hint');
  });

  it('muestra y retira los errores locales y sus estados PrimeNG al corregir los cinco campos', () => {
    submitForm();
    const fields = ['first-name', 'last-name', 'email', 'password'] as const;
    for (const field of fields) {
      const input: HTMLInputElement = fixture.nativeElement.querySelector(`#register-${field}`);
      const error: HTMLElement = fixture.nativeElement.querySelector(`#register-${field}-error`);
      expect(inputInvalid(`register-${field}`)).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toContain(error.id);
      const message = error.matches('p-message') ? error : error.querySelector('p-message')!;
      expect(message.getAttribute('role')).toBe('none');
      expect(message.getAttribute('aria-live')).toBe('polite');
      expect(message.textContent?.trim()).not.toBe('');
    }
    expect(fixture.nativeElement.querySelectorAll('p-message').length).toBe(5);
    component.form.setValue(validRequest);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('p-message').length).toBe(0);
    for (const field of fields) {
      const input: HTMLInputElement = fixture.nativeElement.querySelector(`#register-${field}`);
      expect(inputInvalid(`register-${field}`)).toBe(false);
      expect(input.getAttribute('aria-invalid')).toBe('false');
    }
    expect(combobox().getAttribute('aria-invalid')).toBe('false');
    expect(component.form.getRawValue()).toEqual(validRequest);
  });

  it('conserva prioridad del error local sobre el externo y el valor escrito', () => {
    fixture.componentRef.setInput('fieldErrors', { email: 'Revisá el correo enviado.' });
    component.form.setValue({ ...validRequest, email: 'incorrecto' });
    component.form.controls.email.markAsTouched();
    fixture.detectChanges();
    const error = () => fixture.nativeElement.querySelector('#register-email-error').textContent;
    expect(error()).toContain('Ingresá un correo electrónico válido.');
    expect(error()).not.toContain('Revisá el correo enviado.');
    component.form.controls.email.setValue('otro@example.org');
    fixture.detectChanges();
    expect(error()).toContain('Revisá el correo enviado.');
    expect(component.form.controls.email.value).toBe('otro@example.org');
    fixture.componentRef.setInput('fieldErrors', {});
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#register-email-error')).toBeNull();
    expect(component.form.controls.email.value).toBe('otro@example.org');
  });

  it('prioriza el error de carga de facultades sin duplicar mensajes y retira el error al recuperar', () => {
    component.form.setValue(validRequest);
    fixture.componentRef.setInput('fieldErrors', { universityId: 'Revisá la facultad enviada.' });
    fixture.componentRef.setInput('universitiesError', 'No se pudieron cargar las facultades.');
    fixture.detectChanges();
    const container: HTMLElement = fixture.nativeElement.querySelector('#register-university-error');
    expect(container.querySelectorAll('p-message').length).toBe(1);
    expect(container.textContent).toContain('No se pudieron cargar las facultades.');
    expect(container.textContent).not.toContain('Revisá la facultad enviada.');
    expect(container.hasAttribute('aria-live')).toBe(false);
    expect(container.querySelector('p-message')?.getAttribute('aria-live')).toBe('polite');
    fixture.componentRef.setInput('universitiesError', null);
    fixture.detectChanges();
    expect(container.textContent).toContain('Revisá la facultad enviada.');
    fixture.componentRef.setInput('fieldErrors', {});
    fixture.detectChanges();
    expect(container.querySelector('p-message')).toBeNull();
    expect(component.form.getRawValue()).toEqual(validRequest);
  });

  it('submitDisabled bloquea el botón y cualquier envío sin bloquear los campos', () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    component.form.setValue(validRequest);
    fixture.componentRef.setInput('submitDisabled', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('fieldset').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('input').matches(':disabled')).toBe(false);
    expect(combobox().getAttribute('aria-disabled')).toBe('false');
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

  it('asocia etiqueta, estado y errores al combobox enfocable', () => {
    expect(combobox().id).toBe('register-university');
    expect(combobox().getAttribute('aria-labelledby')).toBe('register-university-label');
    expect(fixture.nativeElement.querySelector('label[for="register-university"]').textContent)
      .toContain('Facultad');
    expect(combobox().getAttribute('aria-describedby'))
      .toBe('register-university-status register-university-error');
    submitForm();
    expect(combobox().getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.querySelector('#register-university-error').textContent)
      .toContain('Seleccioná tu facultad.');
    fixture.componentRef.setInput('fieldErrors', { universityId: 'Facultad no disponible.' });
    component.form.controls.universityId.setValue(universities[0].id);
    fixture.detectChanges();
    expect(combobox().getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.querySelector('#register-university-error').textContent)
      .toContain('Facultad no disponible.');
  });

  it('permite abrir, seleccionar y cerrar mediante teclado sin enviar el formulario', async () => {
    const emitted = vi.fn();
    component.registerRequested.subscribe(emitted);
    combobox().focus();
    const key = async (code: string) => {
      combobox().dispatchEvent(new KeyboardEvent('keydown', { key: code, code, bubbles: true, cancelable: true }));
      fixture.detectChanges();
      await fixture.whenStable();
    };
    await key('ArrowDown');
    expect(combobox().getAttribute('aria-expanded')).toBe('true');
    await key('Home');
    await key('ArrowDown');
    await key('Enter');
    expect(component.form.controls.universityId.value).toBe(universities[1].id);
    expect(combobox().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(combobox());
    await key('ArrowDown');
    await key('Escape');
    expect(combobox().getAttribute('aria-expanded')).toBe('false');
    expect(component.form.controls.universityId.value).toBe(universities[1].id);
    expect(emitted).not.toHaveBeenCalled();
  });

  it.each(['loading', 'universitiesLoading', 'universitiesError', 'empty'])(
    'bloquea apertura y selección durante %s y conserva el UUID', async (state) => {
      component.form.setValue(validRequest);
      if (state === 'empty') fixture.componentRef.setInput('universities', []);
      else fixture.componentRef.setInput(state, state === 'universitiesError' ? 'Error de carga.' : true);
      fixture.detectChanges();
      expect(component.form.controls.universityId.disabled).toBe(true);
      expect(combobox().getAttribute('aria-disabled')).toBe('true');
      expect(combobox().getAttribute('tabindex')).toBe('-1');
      await openUniversities();
      combobox().dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true,
      }));
      fixture.detectChanges();
      expect(combobox().getAttribute('aria-expanded')).toBe('false');
      expect(document.querySelector('[role="listbox"]')).toBeNull();
      expect(component.form.getRawValue().universityId).toBe(validRequest.universityId);
      if (state === 'empty') fixture.componentRef.setInput('universities', universities);
      else fixture.componentRef.setInput(state, state === 'universitiesError' ? null : false);
      fixture.detectChanges();
      expect(component.form.controls.universityId.enabled).toBe(true);
      expect(combobox().getAttribute('aria-disabled')).toBe('false');
      expect(component.form.valid).toBe(true);
    },
  );

  it('cierra el desplegable ya abierto al comenzar el envío y conserva la selección', async () => {
    component.form.setValue(validRequest);
    fixture.detectChanges();
    await openUniversities();
    expect(combobox().getAttribute('aria-expanded')).toBe('true');
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(combobox().getAttribute('aria-expanded')).toBe('false');
    expect(combobox().getAttribute('aria-disabled')).toBe('true');
    expect(component.form.getRawValue().universityId).toBe(validRequest.universityId);
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
