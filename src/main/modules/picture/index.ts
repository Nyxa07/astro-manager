import { type ChannelsOf, IPC, IpcContract } from '../../../shared/ipc';
import type { PictureInfo, ScanSummary } from '../../../shared/modules/picture';
import { type Handler, type IpcModule, noArgsValidator } from '../../module';
import type { Session } from '../../session';

export type PictureDeps = {
  session: Pick<Session, 'current'>;
};

type PictureIpc = typeof IPC.picture;
type PictureChannel = ChannelsOf<PictureIpc>;

export const createPictureModule = (deps: PictureDeps) => {
  const scan: Handler<PictureIpc['scan']> = async () => {
    return null;
  };

  const list: Handler<PictureIpc['list']> = () => {
    return null;
  };

  return {
    handlers: {
      [IPC.picture.scan]: scan,
      [IPC.picture.list]: list,
    },
    validators: {
      [IPC.picture.scan]: noArgsValidator,
      [IPC.picture.list]: noArgsValidator,
    },
  } satisfies IpcModule<PictureChannel>;
};
