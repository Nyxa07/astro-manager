import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { WorkspaceInfo } from '../../shared/modules/workspace';
import { App } from './app';
import { Workspace } from './modules/workspace/workspace';

const alpha: WorkspaceInfo = { id: 'a', name: 'alpha', root: '/photos/alpha' };

const workspace = {
  current: signal<WorkspaceInfo | null>(null),
  recent: signal<WorkspaceInfo[]>([]),
  open: vi.fn<Workspace['open']>(),
  reopen: vi.fn<Workspace['reopen']>(),
} satisfies Pick<Workspace, 'current' | 'recent' | 'open' | 'reopen'>;

const mount = async (): Promise<HTMLElement> => {
  const fixture: ComponentFixture<App> = TestBed.createComponent(App);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
};

describe('App', () => {
  beforeEach(async () => {
    workspace.current.set(null);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: Workspace, useValue: workspace }],
    }).compileComponents();
  });

  it("affiche l'accueil tant qu'aucun espace n'est ouvert", async () => {
    const element = await mount();

    expect(element.querySelector('app-workspace-picker')).not.toBeNull();
    expect(element.querySelector('.shell')).toBeNull();
  });

  it("affiche l'espace ouvert à la place de l'accueil", async () => {
    workspace.current.set(alpha);

    const element = await mount();

    expect(element.querySelector('app-workspace-picker')).toBeNull();
    expect(element.querySelector('.shell h1')?.textContent).toContain('alpha');
    expect(element.querySelector('.shell')?.textContent).toContain('/photos/alpha');
  });
});
