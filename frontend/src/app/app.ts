import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { LoginDialog } from './auth/login-dialog';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet, LoginDialog, ButtonModule, MessageModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly auth = inject(AuthService);
  constructor() { this.auth.restore(); }
}
