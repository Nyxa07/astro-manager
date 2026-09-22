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
export const PICTURE_KINDS = ['fits', 'raw', 'tiff', 'jpeg', 'png'] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

export const isPictureKind = (v: unknown): v is PictureKind =>
  typeof v === 'string' && (PICTURE_KINDS as readonly string[]).includes(v);

export type ThumbUrl = `workspace://thumb/${number}`;
export type FileUrl = `workspace://file/${string}`;
export type RelativePath<P> = P extends `/${string}` ? never : P;

export const thumbUrl = (id: number): ThumbUrl => `workspace://thumb/${id}`;

export const fileUrl = <P extends string>(path: RelativePath<P>): FileUrl =>
  `workspace://file/${path.split('/').map(encodeURIComponent).join('/')}`;
