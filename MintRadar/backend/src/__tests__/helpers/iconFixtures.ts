// Smallest byte strings that carry a real signature AND a readable pixel size, for the icon proxy tests. The proxy
// refuses a PNG, JPEG, GIF or WebP whose declared size it cannot read (mintIcon.ts, iconDimensionsAllowed), so a bare
// signature is no longer a servable icon. None of these is a decodable image; nothing in the backend decodes one.

export function pngOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  b[24] = 8
  b[25] = 6
  return b
}

export function jpegOf(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  const sof = Buffer.alloc(13)
  sof[0] = 0xff
  sof[1] = 0xc0
  sof.writeUInt16BE(11, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 1
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof])
}

export function gifOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(13)
  b.write('GIF89a', 0, 'latin1')
  b.writeUInt16LE(width, 6)
  b.writeUInt16LE(height, 8)
  return b
}

/** Extended-format WebP (VP8X): 24-bit canvas width - 1 and height - 1. */
export function webpOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'latin1')
  b.writeUInt32LE(22, 4)
  b.write('WEBP', 8, 'latin1')
  b.write('VP8X', 12, 'latin1')
  b.writeUInt32LE(10, 16)
  b.writeUIntLE(width - 1, 24, 3)
  b.writeUIntLE(height - 1, 27, 3)
  return b
}
