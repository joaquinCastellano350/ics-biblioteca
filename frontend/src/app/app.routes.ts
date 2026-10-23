import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'catalogo',
    title: 'Catálogo · Biblioteca Digital Universitaria',
    loadComponent: () => import('./catalog/catalog-page').then((m) => m.CatalogPage),
  },
  {
    path: 'registro',
    title: 'Registro · Biblioteca Digital Universitaria',
    loadComponent: () => import('./features/auth/register/register-page')
      .then((module) => module.RegisterPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'catalogo' },
  { path: '**', redirectTo: 'catalogo' },
];
