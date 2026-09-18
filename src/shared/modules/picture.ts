export type PictureKind = 'fits' | 'raw' | 'tiff' | 'jpeg' | 'png';
export type PictureInfo = {
  id: number;
  path: string;
  kind: PictureKind;
  size: number;
  mtime: number;
};
export type ScanSummary = {
  added: number;
  removed: number;
  changed: number;
};
