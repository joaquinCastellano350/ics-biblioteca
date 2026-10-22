import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { LoginDialog } from './auth/login-dialog';

@Component({
  imports: [RouterOutlet, LoginDialog],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly auth = inject(AuthService);

  constructor() { this.auth.restore(); }
}
