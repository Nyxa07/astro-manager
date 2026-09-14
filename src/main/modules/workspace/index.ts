import { type dialog } from 'electron';
import { IPC, type ChannelsOf } from '../../../shared/ipc';
import { type WorkspaceInfo } from '../../../shared/modules/workspace';
import type { Handler, IpcModule, Validator } from '../../module';
import * as path from 'node:path';
import { createRegistry } from './registry';
import { createSession } from './session';

export type WorkspaceDeps = {
  dialog: Pick<typeof dialog, 'showOpenDialog'>;
  userDataDir: string;
};

type WorkspaceIpc = typeof IPC.workspace;
type WorkspaceChannel = ChannelsOf<WorkspaceIpc>;

const REGISTRY_FILE = 'workspaces.json';

const openValidator: Validator<WorkspaceIpc['open']> = (args) => (args.length === 0 ? [] : null);
const reopenValidator: Validator<WorkspaceIpc['reopen']> = (args) =>
  args.length === 1 && typeof args[0] === 'string' ? [args[0]] : null;
const listValidator: Validator<WorkspaceIpc['list']> = (args) => (args.length === 0 ? [] : null);

export const createWorkspaceModule = (deps: WorkspaceDeps) => {
  const registry = createRegistry(path.join(deps.userDataDir, REGISTRY_FILE));
  const session = createSession();

  const open: Handler<WorkspaceIpc['open']> = async () => {
    const { canceled, filePaths } = await deps.dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) {
      return null;
    }
    const info = session.open(filePaths[0]);
    registry.remember(info);

    return info;
  };

  const reopen: Handler<WorkspaceIpc['reopen']> = (root: string) => {
    const entry = registry.list().find((w) => w.root === root);
    if (!entry) {
      return null;
    }
    const info = session.open(entry.root);
    registry.remember(info);
    return info;
  };

  const list: Handler<WorkspaceIpc['list']> = (): WorkspaceInfo[] => {
    return registry.list();
  };

  return {
    handlers: {
      [IPC.workspace.open]: open,
      [IPC.workspace.reopen]: reopen,
      [IPC.workspace.list]: list,
    },
    validators: {
      [IPC.workspace.open]: openValidator,
      [IPC.workspace.reopen]: reopenValidator,
      [IPC.workspace.list]: listValidator,
    },
  } satisfies IpcModule<WorkspaceChannel>;
};
