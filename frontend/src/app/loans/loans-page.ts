import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-loans-page',
  imports: [RouterLink, ButtonModule, ProgressSpinnerModule],
  templateUrl: './loans-page.html',
  styleUrl: './loans-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoansPage {
  protected readonly auth = inject(AuthService);
}
