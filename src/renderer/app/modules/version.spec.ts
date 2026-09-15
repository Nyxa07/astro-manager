import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ElectronApi } from '../../../shared/ipc';
import { ELECTRON_API } from '../electron-api';
import { Version } from './version';

const get = vi.fn<ElectronApi['version']['get']>();

const api = {
  version: { get },
  workspace: { open: async () => null, reopen: async () => null, list: async () => [] },
} satisfies ElectronApi;

/** L'injectable, sa resource chargée. */
const loaded = async (): Promise<Version> => {
  const version = TestBed.inject(Version);
  await TestBed.inject(ApplicationRef).whenStable();
  return version;
};

describe('Version', () => {
  beforeEach(() => {
    get.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: ELECTRON_API, useValue: api }] });
  });

  it("charge les versions d'Electron et de Node par le pont", async () => {
    get.mockImplementation(async (key) => ({ electron: '44.2.0', node: '24.20.0' })[key]);

    const version = await loaded();

    expect(version.versions.value()).toEqual({ electron: '44.2.0', node: '24.20.0' });
    expect(version.versions.isLoading()).toBe(false);
  });

  it('rend null hors Electron, sans rien demander', async () => {
    TestBed.overrideProvider(ELECTRON_API, { useValue: undefined });

    const version = await loaded();

    expect(version.versions.value()).toBeNull();
    expect(version.versions.isLoading()).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});
