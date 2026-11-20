// Generates the app icons (PNG) for the PWA manifest without any image dependency.
// The mark: three stacked boxes, light on the app's dark neutral, matching public/favicon.svg.
// Run: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [0x17, 0x19, 0x18]
const FG = [0xf1, 0xf2, 0xf2]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, draw) {
  const px = Buffer.alloc(size * size * 3)
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 3
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
  }
  draw(set)
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0 // filter: none
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Boxes on a 16-unit grid: two on the bottom row, one on top. `scale` shrinks the mark towards the centre. */
const BOXES = [
  [5.75, 3.25, 10.25, 7.75],
  [3, 8.25, 7.5, 12.75],
  [8.5, 8.25, 13, 12.75],
]

function icon(size, scale) {
  return png(size, (set) => {
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) set(x, y, BG)
    const u = size / 16
    const map = (v) => (8 + (v - 8) * scale) * u
    for (const [x0, y0, x1, y1] of BOXES) {
      const [ax, ay, bx, by] = [map(x0), map(y0), map(x1), map(y1)].map(Math.round)
      for (let y = ay; y < by; y += 1) for (let x = ax; x < bx; x += 1) set(x, y, FG)
      // Packing tape: a dark band across the top third of each box.
      const tapeTop = Math.round(ay + (by - ay) * 0.28)
      const tapeBottom = Math.round(ay + (by - ay) * 0.4)
      for (let y = tapeTop; y < tapeBottom; y += 1) for (let x = ax; x < bx; x += 1) set(x, y, BG)
    }
  })
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-192.png', icon(192, 1))
writeFileSync('public/icons/icon-512.png', icon(512, 1))
// Maskable icons are cropped to a circle by some launchers: keep the mark inside the central 80% safe zone.
writeFileSync('public/icons/icon-maskable-512.png', icon(512, 0.72))
writeFileSync('public/icons/apple-touch-icon.png', icon(180, 0.85))
console.log('icons written to public/icons')
