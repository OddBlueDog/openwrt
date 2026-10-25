// A QR code encoder, small enough for a Wi-Fi network's details or a
// WireGuard config: byte mode, error correction level M, versions 1 to 20
// (up to 666 bytes). It follows ISO/IEC 18004 the way Project Nayuki's
// reference encoder lays it out
// (https://www.nayuki.io/page/qr-code-generator-library, MIT): data and
// Reed-Solomon codewords, the function patterns, then the mask that leaves
// the fewest look-alike patterns.

// level M, by version (index 0 unused)
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const MAX_VERSION = 20;
// format information's two bits for level M
const LEVEL_M = 0;

/** The modules (bits) of a version's symbol that carry data and error correction. */
function rawModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

function dataCodewords(version: number): number {
  return Math.floor(rawModules(version) / 8) - (ECC_PER_BLOCK[version] ?? 0) * (BLOCKS[version] ?? 0);
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j] ?? 0, root);
      if (j + 1 < degree) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

/** Split into blocks, add each one's error correction, and interleave them. */
function withEcc(data: readonly number[], version: number): number[] {
  const blocks = BLOCKS[version] ?? 1;
  const eccLen = ECC_PER_BLOCK[version] ?? 0;
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    all.push([...dat, ...ecc]);
  }
  const out: number[] = [];
  const len = all[0]?.length ?? 0;
  for (let i = 0; i < len; i++) {
    all.forEach((block, j) => {
      // short blocks' padding byte isn't sent
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i] ?? 0);
    });
  }
  return out;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Rows of modules (true: dark), without the quiet zone; undefined if `text` is too long. */
export function qrModules(text: string): boolean[][] | undefined {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  const countBits = (v: number): number => (v < 10 ? 8 : 16);
  while (version <= MAX_VERSION && 4 + countBits(version) + 8 * bytes.length > dataCodewords(version) * 8) version++;
  if (version > MAX_VERSION) return undefined;

  // the data: byte mode, its length, the bytes, a terminator, then padding
  const bits: number[] = [];
  const put = (value: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, countBits(version));
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(version) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean): void => {
    const row = modules[y];
    const frow = fixed[y];
    if (row === undefined || frow === undefined || x < 0 || x >= size) return;
    row[x] = dark;
    frow[x] = true;
  };

  // timing lines, finders (with their separators), alignment patterns
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (cx + dx >= 0 && cx + dx < size && cy + dy >= 0 && cy + dy < size) set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  const align = alignmentPositions(version);
  const last = align.length - 1;
  align.forEach((ax, i) => {
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });

  const drawFormat = (mask: number): void => {
    const data = (LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(f, i));
    set(8, 7, bit(f, 6));
    set(8, 8, bit(f, 7));
    set(7, 8, bit(f, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(f, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(f, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(f, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(v, i));
      set(b, a, bit(v, i));
    }
  }

  // the codewords, two columns at a time in a zigzag from the bottom right
  const stream = withEcc(codewords, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const row = modules[y];
        if (row !== undefined && fixed[y]?.[x] !== true && i < stream.length * 8) {
          row[x] = bit(stream[i >>> 3] ?? 0, 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (mask: number): void => {
    for (let y = 0; y < size; y++) {
      const row = modules[y];
      if (row === undefined) continue;
      for (let x = 0; x < size; x++) if (fixed[y]?.[x] !== true && maskBit(mask, x, y)) row[x] = row[x] !== true;
    }
  };
  // a simpler penalty than the standard's (runs, 2×2 blocks, balance), enough to avoid a bad mask
  const penalty = (): number => {
    let score = 0;
    for (let a = 0; a < size; a++) {
      let runRow = 1;
      let runCol = 1;
      for (let b = 1; b < size; b++) {
        if (modules[a]?.[b] === modules[a]?.[b - 1]) runRow++;
        else {
          if (runRow >= 5) score += runRow - 2;
          runRow = 1;
        }
        if (modules[b]?.[a] === modules[b - 1]?.[a]) runCol++;
        else {
          if (runCol >= 5) score += runCol - 2;
          runCol = 1;
        }
      }
      if (runRow >= 5) score += runRow - 2;
      if (runCol >= 5) score += runCol - 2;
    }
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = modules[y]?.[x];
        if (c === true) dark++;
        if (x < size - 1 && y < size - 1 && c === modules[y]?.[x + 1] && c === modules[y + 1]?.[x] && c === modules[y + 1]?.[x + 1]) score += 3;
      }
    }
    return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty();
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return modules;
}

/** What a phone's camera reads to join a Wi-Fi network (the ZXing "WIFI:" format). */
export function wifiQrText(ssid: string, encryption: string, key: string, hidden = false): string {
  const esc = (s: string): string => s.replace(/([\\;,:"])/g, '\\$1');
  // a hidden network isn't in scans: H:true has the phone join it anyway
  const h = hidden ? 'H:true;' : '';
  if (encryption === 'none') return `WIFI:T:nopass;S:${esc(ssid)};${h};`;
  // WPA covers WPA2 and WPA3 transition mode; a WPA3-only network says so
  const type = encryption === 'sae' ? 'SAE' : 'WPA';
  return `WIFI:T:${type};S:${esc(ssid)};P:${esc(key)};${h};`;
}
