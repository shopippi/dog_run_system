import { describe, expect, it } from 'vitest';
import { jpegSize } from '../src';
import { fakeJpeg } from './fake-jpeg';

describe('JPEG の大きさの読み取り', () => {
  it('SOF から縦横を読む', () => {
    expect(jpegSize(fakeJpeg(800, 600))).toEqual({ width: 800, height: 600 });
    expect(jpegSize(fakeJpeg(240, 240))).toEqual({ width: 240, height: 240 });
  });

  it('JPEG でなければ null', () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegSize(new Uint8Array([]))).toBeNull();
  });
});
