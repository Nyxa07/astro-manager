import { describe, expect, it } from 'vitest';
import { kindOf } from './kind';

// La sorte est une catégorie, l'extension une graphie : plusieurs graphies
// par sorte, en toute casse — les cartes et les logiciels de capture écrivent
// volontiers .FIT ou .JPG. La liste RAW commence par les boîtiers courants ;
// elle grandira avec les fichiers rencontrés.

describe('kindOf', () => {
  it.each([
    ['light_001.fits', 'fits'],
    ['light_001.fit', 'fits'],
    ['light_001.fts', 'fits'],
    ['IMG_0001.cr2', 'raw'],
    ['IMG_0001.cr3', 'raw'],
    ['DSC_0001.nef', 'raw'],
    ['DSC00001.arw', 'raw'],
    ['IMG_0001.dng', 'raw'],
    ['stack.tif', 'tiff'],
    ['stack.tiff', 'tiff'],
    ['final.jpg', 'jpeg'],
    ['final.jpeg', 'jpeg'],
    ['final.png', 'png'],
  ])('reconnaît %s comme %s', (name, kind) => {
    expect(kindOf(name)).toBe(kind);
  });

  it.each([
    ['LIGHT_001.FIT', 'fits'],
    ['IMG_0001.CR2', 'raw'],
    ['Final.JPG', 'jpeg'],
  ])('ignore la casse : %s est %s', (name, kind) => {
    expect(kindOf(name)).toBe(kind);
  });

  it("ne regarde que la dernière extension d'un nom", () => {
    expect(kindOf('M31/2026-09-17/light_001.fits')).toBe('fits');
    expect(kindOf('light_001.fits.bak')).toBeNull();
  });

  it.each([
    ['un texte', 'notes.txt'],
    ['un script', 'process.py'],
    ['un format non pris en charge', 'stack.xisf'],
    ['un nom sans extension', 'README'],
    ['un nom caché sans extension', '.astro-manager'],
    ['une extension seule', '.fits'],
  ])('rend null pour %s', (_label, name) => {
    expect(kindOf(name)).toBeNull();
  });
});
