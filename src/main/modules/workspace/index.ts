import { type dialog } from 'electron';
import { IPC, type IpcContract, type ChannelsOf } from '../../../shared/ipc';
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
/** Les canaux du module dont le contrat ne prend aucun argument. */
type NoArgChannel = {
  [C in WorkspaceChannel]: IpcContract[C] extends () => unknown ? C : never;
}[WorkspaceChannel];

const REGISTRY_FILE = 'workspaces.json';

const noArgsValidator: Validator<NoArgChannel> = (args) => (args.length === 0 ? [] : null);
const reopenValidator: Validator<WorkspaceIpc['reopen']> = (args) =>
  args.length === 1 && typeof args[0] === 'string' ? [args[0]] : null;

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

  const current: Handler<WorkspaceIpc['current']> = () => session.current();

  return {
    handlers: {
      [IPC.workspace.open]: open,
      [IPC.workspace.reopen]: reopen,
      [IPC.workspace.list]: list,
      [IPC.workspace.current]: current,
    },
    validators: {
      [IPC.workspace.open]: noArgsValidator,
      [IPC.workspace.reopen]: reopenValidator,
      [IPC.workspace.list]: noArgsValidator,
      [IPC.workspace.current]: noArgsValidator,
    },
  } satisfies IpcModule<WorkspaceChannel>;
};
