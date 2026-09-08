import { TestBed } from '@angular/core/testing';
import type { ElectronApi } from '../../shared/ipc';
import { App } from './app';

/** Le texte affiché une fois la resource résolue. */
const renderInfo = async (): Promise<string> => {
  const fixture = TestBed.createComponent(App);
  await fixture.whenStable();
  const compiled = fixture.nativeElement as HTMLElement;
  return compiled.querySelector('#info')?.textContent ?? '';
};

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  describe('versions', () => {
    afterEach(() => {
      delete window.electronApi;
    });

    it("affiche les versions quand le pont d'Electron est présent", async () => {
      window.electronApi = {
        versions: {
          get: async (key) => ({ node: '24.20.0', electron: '44.2.0' })[key],
        },
      } satisfies ElectronApi;

      expect(await renderInfo()).toContain('Utilise Node 24.20.0 et Electron 44.2.0');
    });

    // Le cas d'un onglet `ng serve` ou d'un test jsdom : le preload n'a
    // rien exposé. Le composant doit dégrader, pas planter.
    it('signale une API indisponible hors Electron', async () => {
      expect(window.electronApi).toBeUndefined();

      expect(await renderInfo()).toContain('API Electron indisponible');
    });
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      "Bonjour depuis le rendu d'Electron !",
    );
  });
});
