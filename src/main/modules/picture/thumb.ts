import * as path from 'node:path';
import type { PictureInfo, PictureKind } from '../../../shared/modules/picture';
import type { WorkspaceInfo } from '../../../shared/modules/workspace';
import { toBgra } from './raster';
import { decodeFits, FitsError, type FitsDeps } from './fits';

export type ThumbDeps = {
  nativeImage: NativeImage;
  fs: FitsDeps['fs'] & {
    access: (path: string) => Promise<void>;
    writeFile: (path: string, buffer: Buffer) => Promise<void>;
    rename: (oldpath: string, newpath: string) => Promise<void>;
    mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
    unlink: (path: string) => Promise<void>;
    readdir: (dir: string) => Promise<string[]>;
  };
};

type ImageDim = { width: number; height: number };

export type ThumbImage = {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: ImageDim): ThumbImage;
  toJPEG(quality: number): Buffer;
};

type NativeImage = {
  createFromPath(file: string): ThumbImage;
  createFromBitmap(buffer: Buffer, options: { width: number; height: number }): ThumbImage;
};

const JPEG_QUALITY = 80;
const BOUNDS = { width: 360, height: 240 };

export const fitInto = (size: ImageDim, bounds: ImageDim): ImageDim => {
  const scale = Math.min(bounds.width / size.width, bounds.height / size.height);
  if (scale >= 1) {
    return size;
  }
  return { width: Math.round(scale * size.width), height: Math.round(scale * size.height) };
};

const thumbsDir = (root: string) => path.join(root, '.astro-manager', 'thumbs');

export const createThumb = (deps: ThumbDeps) => {
  const memory = new Set<string>();

  const render = async (file: string, kind: PictureKind): Promise<Buffer | null> => {
    switch (kind) {
      case 'jpeg':
      case 'png': {
        const image = deps.nativeImage.createFromPath(file);
        if (image.isEmpty()) {
          return null;
        }
        const size = image.getSize();
        const fitted = fitInto(size, BOUNDS);
        return fitted === size
          ? image.toJPEG(JPEG_QUALITY)
          : image.resize(fitted).toJPEG(JPEG_QUALITY);
      }
      case 'fits': {
        const raster = await decodeFits({ fs: deps.fs }, file, BOUNDS);
        const { width, height } = raster;
        return deps.nativeImage
          .createFromBitmap(toBgra(raster), { width, height })
          .toJPEG(JPEG_QUALITY);
      }
      default:
        return null;
    }
  };

  const ensure = async (
    workspace: Pick<WorkspaceInfo, 'id' | 'root'>,
    picture: Pick<PictureInfo, 'id' | 'kind' | 'path'>,
  ): Promise<string | null> => {
    const key = `${workspace.id}:${picture.id}`;

    if (memory.has(key)) {
      return null;
    }

    const file = path.join(thumbsDir(workspace.root), `${picture.id}.jpg`);

    try {
      await deps.fs.access(file);
      return file;
    } catch {
      // Défaut de cache
    }

    try {
      const jpeg = await render(path.join(workspace.root, picture.path), picture.kind);
      if (!jpeg) {
        memory.add(key);
        return null;
      }
      await deps.fs.mkdir(path.dirname(file), { recursive: true });
      await deps.fs.writeFile(`${file}.part`, jpeg);
      await deps.fs.rename(`${file}.part`, file);
      return file;
    } catch (e) {
      if (e instanceof FitsError || (e instanceof Error && 'code' in e)) {
        memory.add(key);
        return null;
      }
      throw e;
    }
  };

  const remove = async (path: string) => {
    try {
      await deps.fs.unlink(path);
    } catch (e) {
      if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) {
        throw e;
      }
    }
  };

  const invalidate = async (
    workspace: Pick<WorkspaceInfo, 'root' | 'id'>,
    ids: number[],
  ): Promise<void> => {
    const dir = thumbsDir(workspace.root);
    const key = (id: number) => `${workspace.id}:${id}`;
    const jpgPath = (id: number) => path.join(dir, `${id}.jpg`);

    await Promise.all(
      ids.map((id) => {
        memory.delete(key(id));
        return remove(jpgPath(id));
      }),
    );
  };

  const purge = async (
    workspace: Pick<WorkspaceInfo, 'root'>,
    known: ReadonlySet<number>,
  ): Promise<void> => {
    const dir = thumbsDir(workspace.root);
    let entries: string[];
    try {
      entries = await deps.fs.readdir(dir);
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
        return;
      }
      throw e;
    }

    await Promise.all(
      entries
        .filter((entry) => {
          const id = /^(\d+)\.jpg$/.exec(entry);
          return !(id && known.has(Number(id[1])));
        })
        .map((entry) => remove(path.join(dir, entry))),
    );
  };

  return { ensure, invalidate, purge };
};
