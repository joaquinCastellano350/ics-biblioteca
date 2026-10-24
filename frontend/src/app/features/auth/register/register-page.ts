import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { Register } from './register';
import type { RegistrationUniversity } from './register';
import { UniversitiesService } from './universities.service';
import { AuthService } from '../../../auth/auth.service';
import type { RegistrationErrorResponse, RegistrationFieldErrors, RegistrationRequest } from './registration.types';

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [Register, RouterLink, ButtonModule],
  templateUrl: './register-page.html',
  styleUrl: './register-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterPage implements OnInit {
  private readonly service = inject(UniversitiesService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly universities = signal<RegistrationUniversity[]>([]);
  readonly universitiesLoading = signal(false);
  readonly universitiesError = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly registered = signal(false);
  readonly registrationError = signal<string | null>(null);
  readonly registrationFieldErrors = signal<RegistrationFieldErrors>({});

  ngOnInit(): void {
    this.loadUniversities();
  }

  register(data: RegistrationRequest): void {
    if (this.auth.authenticating() || this.submitting() || this.registered() || this.universitiesLoading()
      || this.universitiesError() || this.universities().length === 0) return;

    this.submitting.set(true);
    this.registrationError.set(null);
    this.registrationFieldErrors.set({});
    this.auth.register(data).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.submitting.set(false)),
    ).subscribe({
      next: () => {
        this.registered.set(true);
        void this.router.navigate(['/']);
      },
      error: (error: unknown) => this.showRegistrationError(error),
    });
  }

  private showRegistrationError(error: unknown): void {
    if (error instanceof HttpErrorResponse && error.status === 400) {
      const body = error.error as RegistrationErrorResponse | null;
      const fields = body?.error?.fields;
      const safeFields: RegistrationFieldErrors = {};
      for (const field of ['firstName', 'lastName', 'universityId', 'email', 'password'] as const) {
        if (typeof fields?.[field] === 'string') safeFields[field] = fields[field];
      }
      this.registrationFieldErrors.set(safeFields);
      this.registrationError.set('Revisá los datos ingresados.');
    } else if (error instanceof HttpErrorResponse && error.status === 409) {
      const message = 'El correo electrónico ya está registrado.';
      this.registrationFieldErrors.set({ email: message });
      this.registrationError.set(message);
    } else {
      this.registrationError.set(error instanceof HttpErrorResponse && error.status === 0
        ? 'No se pudo conectar con el servidor. Intentá nuevamente.'
        : 'No se pudo completar el registro. Intentá nuevamente más tarde.');
    }
  }

  loadUniversities(): void {
    if (this.universitiesLoading()) return;
    this.universitiesLoading.set(true);
    this.universitiesError.set(null);
    this.universities.set([]);

    this.service.list().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.universitiesLoading.set(false)),
    ).subscribe({
      next: (universities) => this.universities.set(universities),
      error: () => this.universitiesError.set(
        'No se pudieron cargar las facultades. Intentá nuevamente.',
      ),
    });
  }
}
