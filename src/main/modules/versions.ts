import { IPC, type ChannelsOf } from '../../shared/ipc';
import { isVersionKey, type VersionKey } from '../../shared/modules/versions';
import type { IpcModule } from '../module';

type VersionsChannel = ChannelsOf<typeof IPC.versions>;

const handlers = {
  [IPC.versions.get]: (input: VersionKey): string => process.versions[input],
} satisfies IpcModule<VersionsChannel>['handlers'];

const validators = {
  [IPC.versions.get]: (args) => (args.length === 1 && isVersionKey(args[0]) ? [args[0]] : null),
} satisfies IpcModule<VersionsChannel>['validators'];

export const versionsModule = {
  handlers,
  validators,
} satisfies IpcModule<VersionsChannel>;
