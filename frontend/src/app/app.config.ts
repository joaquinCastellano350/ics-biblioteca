import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import { bibliotecaTheme } from './theme';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    providePrimeNG({
      license: 'eyJpZCI6IjBiZWJlN2RmLTNlNjYtNDQ4Yy1hNDMzLTg5ZjFkN2U0YzhjMyIsInByb2R1Y3QiOiJwcmltZXVpIiwidGllciI6ImNvbW11bml0eSIsInR5cGUiOiJkZXYiLCJpYXQiOjE3OTI2ODk5NTIsImV4cCI6MTgyNDIyNTk1Mn0.qsT6W5j5KQrbeOMAfA8AiFvnvhYOBZVUsbS9K2l4TOTi5HjQdi4z2hzZDh56koMowBmuwouzDalPVXgtz77ZDw',
      theme: { preset: bibliotecaTheme, options: { darkModeSelector: false } },
      translation: { aria: { close: 'Cerrar' } },
    }),
    provideRouter(routes)
  ]
};
