import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { AcceptReservation } from './accept-reservation';

@Component({
  selector: 'app-reservation-page',
  imports: [RouterLink, ButtonModule, AcceptReservation],
  template: `
    <main class="wrap" id="main-content" tabindex="-1">
      <section aria-labelledby="turn-title">
        <p class="eyebrow">Tu próxima lectura</p>
        <h1 id="turn-title">Aceptar tu cupo reservado</h1>
        <p>Ingresá con la cuenta que recibió el aviso. La aceptación continúa automáticamente, sin otra confirmación.</p>
        <app-accept-reservation [reservationId]="id()" [automatic]="true" />
        <a pButton routerLink="/prestamos" variant="outlined">Ver mis préstamos</a>
        <a routerLink="/catalogo">Explorar catálogo</a>
      </section>
    </main>
  `,
  styles: `
    main { padding-block: 56px 72px; }
    section { max-width: 620px; margin: auto; display: flex; flex-direction: column; gap: 24px;
      padding: 28px; border: 1px solid var(--bdu-line); border-radius: 14px; background: white; }
    h1 { font-size: clamp(1.6rem, 4vw, 2.2rem); }
    p { line-height: 1.6; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReservationPage {
  readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map(params => params.get('reservationId') ?? '')), { initialValue: '' });
}
