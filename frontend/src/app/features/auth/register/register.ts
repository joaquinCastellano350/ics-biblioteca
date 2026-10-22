import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

// Se conserva universityId para respetar el contrato HTTP, aunque la interfaz diga facultad.
export interface RegistrationUniversity {
  id: string;
  name: string;
}

export interface RegistrationRequest {
  firstName: string;
  lastName: string;
  universityId: string;
  email: string;
  password: string;
}

export type RegistrationField = keyof RegistrationRequest;
export type RegistrationFieldErrors = Partial<Record<RegistrationField, string>>;

const requiredText: ValidatorFn = (control) =>
  typeof control.value === 'string' && control.value.trim().length > 0
    ? null
    : { required: true };

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, InputTextModule, ButtonModule],
  templateUrl: './register.html',
  styleUrl: './register.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  readonly universities = input<readonly RegistrationUniversity[]>([]);
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
      validators: [requiredText, Validators.email],
    }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    effect(() => {
      this.universities();
      this.form.controls.universityId.updateValueAndValidity({ emitEvent: false });
    });
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
      // La contraseña se transmite sin transformaciones al contenedor.
    });
  }
}
