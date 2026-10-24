import { ChangeDetectionStrategy, Component, computed, effect, input, output, untracked, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { Select, SelectModule } from 'primeng/select';
import type { SelectPassThrough } from 'primeng/select';
import { emailValidator, normalizeEmail } from '../../../auth/auth.validation';
import type { University as RegistrationUniversity, RegistrationRequest, RegistrationFieldErrors } from '../../../auth/auth.types';
export type { University as RegistrationUniversity, RegistrationRequest, RegistrationFieldErrors } from '../../../auth/auth.types';

// Se conserva universityId para respetar el contrato HTTP, aunque la interfaz diga facultad.
export type RegistrationField = keyof RegistrationRequest;

const requiredText: ValidatorFn = (control) =>
  typeof control.value === 'string' && control.value.trim().length > 0
    ? null
    : { required: true };

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, InputTextModule, ButtonModule, SelectModule, MessageModule],
  templateUrl: './register.html',
  styleUrl: './register.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  private readonly universitySelect = viewChild(Select);
  readonly universities = input<readonly RegistrationUniversity[]>([]);
  readonly universityOptions = computed(() => [...this.universities()]);
  readonly universitiesLoading = input(false);
  readonly universitiesError = input<string | null>(null);
  readonly loading = input(false);
  readonly submitDisabled = input(false);
  readonly errorMessage = input<string | null>(null);
  // El contenedor administra estos errores y los limpia cuando corresponda.
  readonly fieldErrors = input<RegistrationFieldErrors>({});
  readonly registerRequested = output<RegistrationRequest>();

  readonly form = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [requiredText] }),
    lastName: new FormControl('', { nonNullable: true, validators: [requiredText] }),
    universityId: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        (control) => !control.value || this.universities().some((item) => item.id === control.value)
          ? null
          : { unknownUniversity: true },
      ],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [requiredText, emailValidator],
    }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    effect(() => {
      this.universities();
      const control = this.form.controls.universityId;
      const blocked = this.loading() || this.universitiesLoading()
        || !!this.universitiesError() || this.universities().length === 0;
      // Reactive Forms transmite el bloqueo al ControlValueAccessor de p-select.
      if (blocked && control.enabled) control.disable({ emitEvent: false });
      else if (!blocked && control.disabled) control.enable({ emitEvent: false });
      control.updateValueAndValidity({ emitEvent: false });
      const select = this.universitySelect();
      if (blocked && select) untracked(() => select.hide());
    });
  }

  protected universityPassThrough(): SelectPassThrough {
    return {
      root: { style: { width: '100%', minWidth: '0', minHeight: '43px', fontSize: '12px' } },
      label: {
        'aria-describedby': 'register-university-status register-university-error',
        'aria-invalid': String(!!this.messageFor('universityId')),
        style: { padding: '11px 13px', lineHeight: '19px' },
      },
      dropdown: { style: { width: '32px', flexShrink: '0' } },
      // El overlay se monta en body para escapar del overflow del layout.
      overlay: { style: { fontFamily: 'var(--bdu-sans, system-ui, sans-serif)', fontSize: '12px' } },
      option: { style: { whiteSpace: 'normal', overflowWrap: 'anywhere' } },
    };
  }

  protected submissionBlocked(): boolean {
    return this.submitDisabled() || this.loading() || this.universitiesLoading()
      || !!this.universitiesError() || this.universities().length === 0;
  }

  protected messageFor(field: RegistrationField): string | null {
    const control = this.form.controls[field];
    if (control.touched || control.dirty) {
      if (control.hasError('required')) {
        const messages: Record<RegistrationField, string> = {
          firstName: 'Ingresá tu nombre.',
          lastName: 'Ingresá tu apellido.',
          universityId: 'Seleccioná tu facultad.',
          email: 'Ingresá tu correo electrónico.',
          password: 'Ingresá una contraseña.',
        };
        return messages[field];
      }
      if (control.hasError('email')) return 'Ingresá un correo electrónico válido.';
      if (control.hasError('unknownUniversity')) return 'Seleccioná una facultad de la lista.';
    }
    return this.fieldErrors()[field] || null;
  }

  submit(): void {
    if (this.submissionBlocked()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const value = this.form.getRawValue();
    this.registerRequested.emit({
      ...value,
      firstName: value.firstName.trim(),
      lastName: value.lastName.trim(),
      email: normalizeEmail(value.email),
      // La contraseña se transmite sin transformaciones al contenedor.
    });
  }
}
