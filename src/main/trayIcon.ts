import { nativeImage, type NativeImage } from 'electron'
import { deflateSync } from 'node:zlib'

// 极简 PNG 编码器：生成纯色小图标，避免打包外部 .ico 资源。
// 仅用于托盘状态指示（绿/红），用户可后续替换为正式图标。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function makeSolidPng(size: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const row = Buffer.alloc(1 + size * 4)
  row[0] = 0
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = rgb[0]
    row[1 + x * 4 + 1] = rgb[1]
    row[1 + x * 4 + 2] = rgb[2]
    row[1 + x * 4 + 3] = 255
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  const idat = deflateSync(raw)
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export function makeStatusIcon(
  status: 'healthy' | 'external' | 'unhealthy' | 'starting' | 'stopped'
): NativeImage {
  const color: [number, number, number] =
    status === 'unhealthy'
      ? [220, 60, 60]
      : status === 'starting'
        ? [230, 180, 60]
        : status === 'stopped'
          ? [120, 120, 120]
          : [60, 190, 90]
  return nativeImage.createFromBuffer(makeSolidPng(32, color))
}
