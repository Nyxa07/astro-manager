import { IPC, type ChannelsOf } from '../../../shared/ipc';
import { type WorkspaceInfo } from '../../../shared/modules/workspace';
import type { Handler, IpcModule, Validator } from '../../module';

type WorkspaceIpc = typeof IPC.workspace;
type WorkspaceChannel = ChannelsOf<WorkspaceIpc>;

const openValidator: Validator<WorkspaceIpc['open']> = (args) => {
  if (args.length !== 0) {
    return null;
  }
  return [];
};

const open: Handler<WorkspaceIpc['open']> = (): WorkspaceInfo => {
  return { id: 'Todo', name: 'test', root: 'Todo' }; // Todo
};

const handlers = {
  [IPC.workspace.open]: open,
} satisfies IpcModule<WorkspaceChannel>['handlers'];

const validators = {
  [IPC.workspace.open]: openValidator,
} satisfies IpcModule<WorkspaceChannel>['validators'];

export const workspaceModule = {
  handlers,
  validators,
} satisfies IpcModule<WorkspaceChannel>;
