import { Component, ElementRef, OnDestroy, effect, inject, viewChild, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription, finalize } from 'rxjs';
import { AuthService } from './auth.service';
import { DOCUMENT } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputPasswordModule } from 'primeng/inputpassword';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-login-dialog',
  imports: [ReactiveFormsModule, DialogModule, ButtonModule, InputTextModule, InputPasswordModule, MessageModule],
  templateUrl: './login-dialog.html',
  styleUrl: './login-dialog.css',
  host: { tabindex: '-1' },
})
export class LoginDialog implements OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private opener: HTMLElement | null = null;
  private request: Subscription | undefined;
  protected readonly pending = signal(false);
  protected readonly error = signal('');
  protected readonly passwordMasked = signal(true);
  protected readonly dialogStyle = {
    width: 'min(470px, calc(100vw - 32px))',
    maxHeight: 'calc(100dvh - 42px)',
  };
  protected readonly dialogParts = {
    root: { id: 'login-dialog', 'aria-describedby': 'login-description' },
    header: { style: { alignItems: 'flex-start' } },
    headerActions: { style: { position: 'absolute', top: '15px', right: '15px' } },
    content: { style: { overflowY: 'auto' } },
  };
  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    effect(() => {
      if (this.auth.loginRequested()) this.opener = this.document.activeElement as HTMLElement | null;
    });
  }

  protected submit(): void {
    if (this.pending()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const { email, password } = this.form.getRawValue();
    if (new TextEncoder().encode(password).length > 1024) {
      this.error.set('La contraseña supera el tamaño permitido.');
      return;
    }
    this.error.set('');
    this.pending.set(true);
    this.request = this.auth.login(email, password).pipe(finalize(() => this.pending.set(false))).subscribe({
      error: (error: HttpErrorResponse) => {
        this.error.set(error.status === 401
          ? 'El correo o la contraseña son incorrectos.'
          : error.status === 400
            ? 'Revisá el correo y la contraseña ingresados.'
            : 'No pudimos iniciar sesión. Intentá nuevamente.');
      },
    });
  }

  protected close(): void {
    this.request?.unsubscribe();
    this.form.reset();
    this.error.set('');
    this.passwordMasked.set(true);
    this.auth.cancelLogin();
  }

  protected focusEmail(): void { this.emailInput()?.nativeElement.focus(); }

  protected afterHide(): void {
    const target = this.opener?.isConnected ? this.opener : this.host.nativeElement;
    target.focus();
    // El blur del último campo debe ocurrir antes de restablecer su estado touched.
    this.close();
    this.opener = null;
  }

  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
