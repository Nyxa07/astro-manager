import { resource, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { WorkspaceInfo } from '../../../../shared/modules/workspace';
import { Version } from '../version';
import { Workspace } from './workspace';
import { WorkspacePicker } from './workspace-picker';

const alpha: WorkspaceInfo = { id: 'a', name: 'alpha', root: '/photos/alpha' };
const beta: WorkspaceInfo = { id: 'b', name: 'beta', root: '/photos/beta' };

// Un composant ne connaît que des injectables : on remplace ceux-là, jamais le pont.
const workspace = {
  current: signal<WorkspaceInfo | null>(null),
  recent: signal<WorkspaceInfo[]>([]),
  open: vi.fn<Workspace['open']>(),
  reopen: vi.fn<Workspace['reopen']>(),
} satisfies Pick<Workspace, 'current' | 'recent' | 'open' | 'reopen'>;

/** Le type de valeur de la resource, tel que Version le publie. */
type Versions = ReturnType<Version['versions']['value']>;

let versions: Versions = null;

/** Une vraie resource, résolue sur la valeur du test : le gabarit lit `value()` et `isLoading()`. */
const fakeVersion = (): Pick<Version, 'versions'> => ({
  versions: resource({ loader: async () => versions }).asReadonly(),
});

const mount = async (): Promise<ComponentFixture<WorkspacePicker>> => {
  const fixture = TestBed.createComponent(WorkspacePicker);
  await fixture.whenStable();
  return fixture;
};

const element = (fixture: ComponentFixture<WorkspacePicker>) =>
  fixture.nativeElement as HTMLElement;

describe('WorkspacePicker', () => {
  beforeEach(async () => {
    workspace.current.set(null);
    workspace.recent.set([]);
    workspace.open.mockReset();
    workspace.reopen.mockReset();
    versions = null;
    await TestBed.configureTestingModule({
      imports: [WorkspacePicker],
      providers: [
        { provide: Workspace, useValue: workspace },
        { provide: Version, useFactory: fakeVersion },
      ],
    }).compileComponents();
  });

  describe('versions', () => {
    it("affiche celles d'Electron et de Node", async () => {
      versions = { electron: '44.2.0', node: '24.20.0' };

      const fixture = await mount();

      expect(element(fixture).textContent).toContain('Electron 44.2.0 · Node 24.20.0');
    });

    it('signale un pont indisponible hors Electron', async () => {
      const fixture = await mount();

      expect(element(fixture).textContent).toContain('pont est indisponible');
    });
  });

  describe('ouverture', () => {
    it("délègue l'ouverture à Workspace", async () => {
      const fixture = await mount();

      element(fixture).querySelector<HTMLButtonElement>('.btn.primary')?.click();

      expect(workspace.open).toHaveBeenCalledOnce();
    });
  });

  describe('récents', () => {
    it('cache la section quand aucun espace n’est connu', async () => {
      const fixture = await mount();

      expect(element(fixture).querySelector('.recent-list')).toBeNull();
    });

    it('liste les espaces connus, le dernier ouvert marqué en tête', async () => {
      workspace.recent.set([alpha, beta]);

      const fixture = await mount();
      const rows = element(fixture).querySelectorAll('.recent');

      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('alpha');
      expect(rows[0].textContent).toContain('/photos/alpha');
      expect(rows[0].querySelector('.chip')?.textContent).toContain('dernier ouvert');
      expect(rows[1].textContent).toContain('beta');
      expect(rows[1].querySelector('.chip')).toBeNull();
    });

    it('rouvre un espace par sa racine', async () => {
      workspace.recent.set([alpha, beta]);
      const fixture = await mount();

      element(fixture).querySelectorAll<HTMLButtonElement>('.recent')[1].click();

      expect(workspace.reopen).toHaveBeenCalledExactlyOnceWith(beta.root);
    });
  });
});
