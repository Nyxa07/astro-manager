import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Plus besoin de withHashLocation() : le protocole app:// donne une vraie
    // origine, et le fallback SPA du main sert index.html sur toute route.
    provideRouter(routes),
  ],
};
