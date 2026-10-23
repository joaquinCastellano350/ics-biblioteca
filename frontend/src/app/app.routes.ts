import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'catalogo',
    title: 'Catálogo · Biblioteca Digital Universitaria',
    loadComponent: () => import('./catalog/catalog-page').then((m) => m.CatalogPage),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'Inicio · Biblioteca Digital Universitaria',
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
  },
  { path: '**', redirectTo: 'catalogo' },
];
