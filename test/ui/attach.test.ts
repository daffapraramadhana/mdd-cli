import { describe, it, expect } from 'vitest';
import {
  dequotePath, isImagePath, mediaTypeFor, imageLabel, stripImageTokens,
  detectImageInsert, attachImages, MAX_IMAGE_BYTES,
} from '../../src/ui/attach.js';

describe('dequotePath', () => {
  it('strips matching single/double quotes and unescapes "\\ "', () => {
    expect(dequotePath("'/a/b c.png'")).toBe('/a/b c.png');
    expect(dequotePath('"/a/b.png"')).toBe('/a/b.png');
    expect(dequotePath('/a/b\\ c.png')).toBe('/a/b c.png');
    expect(dequotePath('/a/b.png')).toBe('/a/b.png');
  });
});

describe('isImagePath', () => {
  it('accepts image extensions (any case) and rejects others', () => {
    expect(isImagePath('/x/y.png')).toBe(true);
    expect(isImagePath('/x/y.JPG')).toBe(true);
    expect(isImagePath('/x/y.jpeg')).toBe(true);
    expect(isImagePath('/x/y.webp')).toBe(true);
    expect(isImagePath('/x/y.txt')).toBe(false);
    expect(isImagePath('hello world')).toBe(false);
    expect(isImagePath('a.png\nb')).toBe(false); // multi-line chunk is not a path
  });
});

describe('mediaTypeFor', () => {
  it('maps extensions to media types (jpg and jpeg → image/jpeg)', () => {
    expect(mediaTypeFor('/a.png')).toBe('image/png');
    expect(mediaTypeFor('/a.jpg')).toBe('image/jpeg');
    expect(mediaTypeFor('/a.JPEG')).toBe('image/jpeg');
    expect(mediaTypeFor('/a.gif')).toBe('image/gif');
    expect(mediaTypeFor('/a.webp')).toBe('image/webp');
  });
});

describe('imageLabel', () => {
  it('formats a chip with the basename', () => {
    expect(imageLabel(1, '/Users/me/Desktop/shot.png')).toBe('[Image #1: shot.png]');
  });
});

describe('stripImageTokens', () => {
  it('removes every image token, leaving other text', () => {
    expect(stripImageTokens('look [Image #1: a.png] and [Image #2: b.jpg] ok')).toBe('look  and  ok');
    expect(stripImageTokens('no tokens')).toBe('no tokens');
  });
});

describe('detectImageInsert', () => {
  it('detects an inserted image path and returns its position + dequoted path', () => {
    expect(detectImageInsert('', "'/a/b c.png'")).toEqual({ path: '/a/b c.png', at: 0, len: "'/a/b c.png'".length });
    expect(detectImageInsert('hi ', 'hi /a/b.png')).toEqual({ path: '/a/b.png', at: 3, len: '/a/b.png'.length });
  });
  it('returns null when the insertion is not an image path', () => {
    expect(detectImageInsert('', 'just text')).toBeNull();
    expect(detectImageInsert('abc', 'ab')).toBeNull(); // deletion
  });
});

describe('attachImages', () => {
  it('encodes readable in-cap files and reports errors for oversize/unreadable', () => {
    const read = (p: string): Uint8Array => {
      if (p === '/ok.png') return new Uint8Array([65, 66, 67]);      // "ABC" → "QUJD"
      if (p === '/big.png') return new Uint8Array(MAX_IMAGE_BYTES + 1);
      throw new Error('ENOENT');
    };
    const { blocks, errors } = attachImages(['/ok.png', '/big.png', '/missing.png'], read);
    expect(blocks).toEqual([{ type: 'image', mediaType: 'image/png', data: 'QUJD' }]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('big.png');
    expect(errors[1]).toContain('missing.png');
  });
});
