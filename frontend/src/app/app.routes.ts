import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'registro',
    loadComponent: () => import('./features/auth/register/register-page')
      .then((module) => module.RegisterPage),
  },
];
