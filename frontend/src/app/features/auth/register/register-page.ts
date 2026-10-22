import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Register } from './register';
import type { RegistrationUniversity } from './register';
import { UniversitiesService } from './universities.service';

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [Register, RouterLink],
  templateUrl: './register-page.html',
  styleUrl: './register-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterPage implements OnInit {
  private readonly service = inject(UniversitiesService);
  private readonly destroyRef = inject(DestroyRef);
  readonly universities = signal<RegistrationUniversity[]>([]);
  readonly universitiesLoading = signal(false);
  readonly universitiesError = signal<string | null>(null);

  ngOnInit(): void {
    this.loadUniversities();
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
