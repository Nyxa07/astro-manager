import { IPC, type ChannelsOf } from '../../../shared/ipc';
import {
  parseWorkspaceCreateInput,
  type WorkspaceCreateInput,
  type WorkspaceInfo,
} from '../../../shared/modules/workspace';
import type { Handler, IpcModule, Validator } from '../../module';

type WorkspaceIpc = typeof IPC.workspace;
type WorkspaceChannel = ChannelsOf<WorkspaceIpc>;

const createValidator: Validator<WorkspaceIpc['create']> = (args) => {
  if (args.length !== 1) {
    return null;
  }
  const parsed = parseWorkspaceCreateInput(args[0]);
  if (parsed === null) {
    return null;
  }
  return [parsed];
};

const create: Handler<WorkspaceIpc['create']> = (input: WorkspaceCreateInput): WorkspaceInfo => {
  return { id: 'Todo', name: 'test', root: 'Todo' }; // Todo
};

const handlers = {
  [IPC.workspace.create]: create,
} satisfies IpcModule<WorkspaceChannel>['handlers'];

const validators = {
  [IPC.workspace.create]: createValidator,
} satisfies IpcModule<WorkspaceChannel>['validators'];

export const workspaceModule = {
  handlers,
  validators,
} satisfies IpcModule<WorkspaceChannel>;
