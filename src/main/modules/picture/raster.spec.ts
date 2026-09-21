import { describe, expect, it } from 'vitest';
import { toBgra } from './raster';

describe('toBgra', () => {
  it('inverse R et B et pose un alpha opaque, pixel par pixel', () => {
    const rgb = Uint8Array.from([10, 20, 30, 40, 50, 60]);
    expect([...toBgra({ width: 2, height: 1, rgb })]).toEqual([30, 20, 10, 255, 60, 50, 40, 255]);
  });
});
