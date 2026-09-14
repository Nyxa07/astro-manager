import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { ElectronApi } from '../../shared/ipc';
import type { WorkspaceInfo } from '../../shared/modules/workspace';
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
      // Le composant n'utilise que `version` : on ne simule que cette branche.
      // `satisfies Pick<…>` garde la vérification stricte sur ce qui est simulé ;
      // le `as` est le seul endroit où le pont est déclaré complet sans l'être.
      const bridge = {
        version: {
          get: async (key) => ({ node: '24.20.0', electron: '44.2.0' })[key],
        },
      } satisfies Pick<ElectronApi, 'version'>;
      window.electronApi = bridge as ElectronApi;

      expect(await renderInfo()).toContain('Utilise Node 24.20.0 et Electron 44.2.0');
    });

    // Le cas d'un onglet `ng serve` ou d'un test jsdom : le preload n'a
    // rien exposé. Le composant doit dégrader, pas planter.
    it('signale une API indisponible hors Electron', async () => {
      expect(window.electronApi).toBeUndefined();

      expect(await renderInfo()).toContain('API Electron indisponible');
    });
  });

  describe('workspace', () => {
    const alpha: WorkspaceInfo = { id: 'a', name: 'alpha', root: '/photos/alpha' };
    const open = vi.fn<ElectronApi['workspace']['open']>();

    /** Un pont complet — `satisfies ElectronApi` évite tout `as` — dont seul `open` est piloté. */
    const installBridge = () => {
      window.electronApi = {
        version: { get: async () => '0' },
        workspace: { open, reopen: async () => null, list: async () => [] },
      } satisfies ElectronApi;
    };

    /** Monte le composant, attend la resource des versions. */
    const mount = async (): Promise<ComponentFixture<App>> => {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      return fixture;
    };

    const clickOpen = async (fixture: ComponentFixture<App>) => {
      (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
      await fixture.whenStable();
    };

    const text = (fixture: ComponentFixture<App>) =>
      (fixture.nativeElement as HTMLElement).textContent ?? '';

    beforeEach(() => {
      open.mockReset();
    });

    afterEach(() => {
      delete window.electronApi;
    });

    it('ouvre un espace via le pont et affiche son identité', async () => {
      installBridge();
      open.mockResolvedValue(alpha);
      const fixture = await mount();

      await clickOpen(fixture);

      expect(open).toHaveBeenCalledOnce();
      expect(text(fixture)).toContain('/photos/alpha');
    });

    // `null` signifie « sélecteur annulé », pas « aucun espace » : le process
    // principal garde le précédent ouvert, l'affichage doit en faire autant.
    it("conserve l'espace affiché quand le sélecteur est annulé", async () => {
      installBridge();
      open.mockResolvedValueOnce(alpha).mockResolvedValueOnce(null);
      const fixture = await mount();

      await clickOpen(fixture);
      await clickOpen(fixture);

      expect(open).toHaveBeenCalledTimes(2);
      expect(text(fixture)).toContain('/photos/alpha');
    });

    it("n'affiche aucun espace hors Electron", async () => {
      expect(window.electronApi).toBeUndefined();
      const fixture = await mount();

      await clickOpen(fixture);

      expect(text(fixture)).not.toContain('INFOS');
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
