import * as fs from 'node:fs';
import { isWorkspaceInfo, type WorkspaceInfo } from '../../../shared/modules/workspace';
import path from 'node:path';

const isUnknownArray = (v: unknown): v is unknown[] => Array.isArray(v);

export type Registry = {
  list(): WorkspaceInfo[];
  remember(info: WorkspaceInfo): void;
  forget(root: string): void;
};

const readRegistryFile = (file: string): WorkspaceInfo[] => {
  if (!fs.existsSync(file)) {
    return [];
  }
  const rawData = fs.readFileSync(file, 'utf-8');
  try {
    const parsed: unknown = JSON.parse(rawData);
    if (!isUnknownArray(parsed)) {
      return [];
    }
    return parsed.filter(isWorkspaceInfo);
  } catch {
    return [];
  }
};

const writeRegistryFile = (file: string, data: WorkspaceInfo[]) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

export const createRegistry = (file: string): Registry => {
  const list = () => {
    return readRegistryFile(file);
  };

  const remember = (info: WorkspaceInfo) => {
    const others = readRegistryFile(file).filter((d) => d.root !== info.root);
    writeRegistryFile(file, [info, ...others]);
  };

  const forget = (root: string) => {
    const currentReg = readRegistryFile(file);
    const newReg = currentReg.filter((i) => i.root !== root);
    if (newReg.length !== currentReg.length) {
      writeRegistryFile(file, newReg);
    }
  };

  return { list, remember, forget };
};
