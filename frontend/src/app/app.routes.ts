import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'catalogo',
    title: 'Catálogo · Biblioteca Digital Universitaria',
    loadComponent: () => import('./catalog/catalog-page').then((m) => m.CatalogPage),
  },
  {
    path: 'prestamos',
    title: 'Mis préstamos · Biblioteca Digital Universitaria',
    loadComponent: () => import('./loans/loans-page').then((m) => m.LoansPage),
  },
  {
    path: 'registro',
    title: 'Registro · Biblioteca Digital Universitaria',
    loadComponent: () => import('./features/auth/register/register-page')
      .then((module) => module.RegisterPage),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'Inicio · Biblioteca Digital Universitaria',
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
  },
  { path: '**', redirectTo: 'catalogo' },
];
