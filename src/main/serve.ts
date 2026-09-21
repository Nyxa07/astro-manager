import type { Stats } from 'node:fs';
import { Readable } from 'node:stream';

export type ServeDeps = {
  fs: { open: (file: string) => Promise<ServedFile> };
};
export type ServedFile = {
  stat: () => Promise<Pick<Stats, 'isFile' | 'size'>>;
  createReadStream: () => Readable;
  close: () => Promise<void>;
};

export const createServe = (deps: ServeDeps) => {
  const serve = async (file: string, type: string): Promise<Response> => {
    let servedFile: ServedFile;
    try {
      servedFile = await deps.fs.open(file);
    } catch (e) {
      if (e instanceof Error && 'code' in e) {
        if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
          return new Response(null, { status: 404 });
        }
      }
      throw e;
    }

    try {
      const stat = await servedFile.stat();

      if (!stat.isFile()) {
        await servedFile.close();
        return new Response(null, { status: 404 });
      }
      const headers = new Headers({ 'Content-Length': stat.size.toString(), 'Content-Type': type });

      return new Response(Readable.toWeb(servedFile.createReadStream()), { headers });
    } catch (e) {
      await servedFile.close();
      throw e;
    }
  };

  return { serve };
};
