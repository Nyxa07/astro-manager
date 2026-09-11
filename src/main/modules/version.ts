import { IPC, type ChannelsOf } from '../../shared/ipc';
import { isVersionKey, type VersionKey } from '../../shared/modules/version';
import type { IpcModule } from '../module';

type VersionIpc = typeof IPC.version;
type VersionChannel = ChannelsOf<VersionIpc>;

const handlers = {
  [IPC.version.get]: (input: VersionKey): string => process.versions[input],
} satisfies IpcModule<VersionChannel>['handlers'];

const validators = {
  [IPC.version.get]: (args) => (args.length === 1 && isVersionKey(args[0]) ? [args[0]] : null),
} satisfies IpcModule<VersionChannel>['validators'];

export const versionModule = {
  handlers,
  validators,
} satisfies IpcModule<VersionChannel>;
