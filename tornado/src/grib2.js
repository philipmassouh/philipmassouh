// Minimal GRIB2 decoder for NCEP HRRR messages.
// Supports data representation templates 5.0 (simple), 5.2/5.3 (complex
// packing, optionally with spatial differencing), grid template 3.30
// (Lambert conformal), optional bitmap (6.0) or none (6.255).
'use strict';

function u16(b, i) { return (b[i] << 8) | b[i + 1]; }
function u32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
// GRIB2 signed ints are sign-and-magnitude, not two's complement.
function s16(b, i) { const v = u16(b, i); return (v & 0x8000) ? -(v & 0x7fff) : v; }
function s32(b, i) { const v = u32(b, i); return (v & 0x80000000) ? -(v & 0x7fffffff) : v; }
function f32(b, i) {
  return new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, false);
}
function signMag(b, i, nOctets) {
  let v = 0;
  for (let k = 0; k < nOctets; k++) v = v * 256 + b[i + k];
  const signBit = Math.pow(2, nOctets * 8 - 1);
  return v >= signBit ? -(v - signBit) : v;
}

class BitReader {
  constructor(bytes, byteOffset) {
    this.b = bytes;
    this.pos = byteOffset * 8; // bit position
  }
  read(nbits) {
    let v = 0;
    let pos = this.pos;
    let remaining = nbits;
    while (remaining > 0) {
      const byteIdx = pos >> 3;
      const bitInByte = pos & 7;
      const take = Math.min(8 - bitInByte, remaining);
      const shift = 8 - bitInByte - take;
      const bits = (this.b[byteIdx] >> shift) & ((1 << take) - 1);
      v = v * (1 << take) + bits;
      pos += take;
      remaining -= take;
    }
    this.pos = pos;
    return v;
  }
  // Read `count` values of `nbits` each into out (Int32Array/Float64Array-like)
  readMany(nbits, count, out, outStart) {
    for (let i = 0; i < count; i++) out[outStart + i] = this.read(nbits);
  }
  alignByte() { this.pos = (this.pos + 7) & ~7; }
}

function decodeGrib2(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer);
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'GRIB') {
    throw new Error('Not a GRIB2 message');
  }
  // Section 0 is 16 octets; total message length octets 9-16.
  let pos = 16;
  const sections = {};
  while (pos < b.length - 4) {
    if (b[pos] === 0x37 && b[pos + 1] === 0x37 && b[pos + 2] === 0x37 && b[pos + 3] === 0x37) break;
    const len = u32(b, pos);
    const num = b[pos + 4];
    sections[num] = { start: pos, len };
    pos += len;
  }
  for (const need of [3, 5, 7]) {
    if (!sections[need]) throw new Error('Missing GRIB2 section ' + need);
  }

  // --- Section 3: grid definition ---
  const s3 = sections[3].start;
  const gridTemplate = u16(b, s3 + 12);
  const npoints = u32(b, s3 + 6);
  let grid = { template: gridTemplate, npoints };
  if (gridTemplate === 30) {
    grid.nx = u32(b, s3 + 30);
    grid.ny = u32(b, s3 + 34);
    grid.la1 = s32(b, s3 + 38) / 1e6;
    grid.lo1 = s32(b, s3 + 42) / 1e6;
    grid.lad = s32(b, s3 + 47) / 1e6;
    grid.lov = s32(b, s3 + 51) / 1e6;
    grid.dx = u32(b, s3 + 55) / 1e6; // metres * 1e-3 -> actually mm*? stored in 1e-3 m units
    grid.dy = u32(b, s3 + 59) / 1e6;
    grid.scanMode = b[s3 + 64];
    grid.latin1 = s32(b, s3 + 65) / 1e6;
    grid.latin2 = s32(b, s3 + 69) / 1e6;
  }

  // --- Section 5: data representation ---
  const s5 = sections[5].start;
  const drTemplate = u16(b, s5 + 9);
  const R = f32(b, s5 + 11);
  const E = s16(b, s5 + 15);
  const D = s16(b, s5 + 17);
  const nbits = b[s5 + 19];
  const Efac = Math.pow(2, E);
  const Dfac = Math.pow(10, D);

  // --- Section 6: bitmap ---
  let bitmap = null;
  if (sections[6]) {
    const s6 = sections[6].start;
    const ind = b[s6 + 5];
    if (ind === 0) {
      bitmap = { bytes: b, offset: s6 + 6 };
    } else if (ind !== 255) {
      throw new Error('Unsupported bitmap indicator ' + ind);
    }
  }

  const s7 = sections[7].start;
  const dataStart = s7 + 5;
  const ndata = npoints; // points described by the grid
  // Number of encoded values: with a bitmap, only the "present" points are packed.
  let nencoded = ndata;
  if (bitmap) {
    nencoded = 0;
    const { bytes, offset } = bitmap;
    for (let i = 0; i < ndata; i++) {
      if (bytes[offset + (i >> 3)] & (0x80 >> (i & 7))) nencoded++;
    }
  }

  let vals; // Float32Array of decoded (unpacked) values, length nencoded
  if (drTemplate === 0) {
    vals = new Float32Array(nencoded);
    if (nbits === 0) {
      vals.fill(R / Dfac);
    } else {
      const br = new BitReader(b, dataStart);
      for (let i = 0; i < nencoded; i++) {
        vals[i] = (R + br.read(nbits) * Efac) / Dfac;
      }
    }
  } else if (drTemplate === 2 || drTemplate === 3) {
    const missingMgmt = b[s5 + 22];
    if (missingMgmt !== 0) throw new Error('Missing-value management not supported');
    const NG = u32(b, s5 + 31);
    const gwRef = b[s5 + 35];
    const gwBits = b[s5 + 36];
    const glRef = u32(b, s5 + 37);
    const glInc = b[s5 + 41];
    const lastGLen = u32(b, s5 + 42);
    const glBits = b[s5 + 46];
    let order = 0, sdOctets = 0;
    if (drTemplate === 3) {
      order = b[s5 + 47];
      sdOctets = b[s5 + 48];
      if (order !== 1 && order !== 2) throw new Error('Unsupported spatial differencing order ' + order);
    }

    let p = dataStart;
    let ival1 = 0, ival2 = 0, gmin = 0;
    if (drTemplate === 3 && sdOctets > 0) {
      ival1 = signMag(b, p, sdOctets); p += sdOctets;
      if (order === 2) { ival2 = signMag(b, p, sdOctets); p += sdOctets; }
      gmin = signMag(b, p, sdOctets); p += sdOctets;
    }

    const br = new BitReader(b, p);
    const grefs = new Int32Array(NG);
    br.readMany(nbits, NG, grefs, 0);
    br.alignByte();
    const gwidths = new Int32Array(NG);
    br.readMany(gwBits, NG, gwidths, 0);
    br.alignByte();
    const glens = new Int32Array(NG);
    br.readMany(glBits, NG, glens, 0);
    br.alignByte();

    const ifld = new Float64Array(nencoded);
    let n = 0;
    for (let g = 0; g < NG; g++) {
      const w = gwRef + gwidths[g];
      const len = (g === NG - 1) ? lastGLen : glRef + glens[g] * glInc;
      const ref = grefs[g];
      if (w === 0) {
        for (let i = 0; i < len; i++) ifld[n++] = ref;
      } else {
        for (let i = 0; i < len; i++) ifld[n++] = ref + br.read(w);
      }
    }
    if (n !== nencoded) throw new Error(`Unpacked ${n} values, expected ${nencoded}`);

    if (drTemplate === 3) {
      // Undo spatial differencing.
      if (order === 1) {
        ifld[0] = ival1;
        for (let i = 1; i < nencoded; i++) ifld[i] = ifld[i] + gmin + ifld[i - 1];
      } else {
        ifld[0] = ival1;
        ifld[1] = ival2;
        for (let i = 2; i < nencoded; i++) {
          ifld[i] = ifld[i] + gmin + 2 * ifld[i - 1] - ifld[i - 2];
        }
      }
    }
    vals = new Float32Array(nencoded);
    for (let i = 0; i < nencoded; i++) vals[i] = (R + ifld[i] * Efac) / Dfac;
  } else {
    throw new Error('Unsupported data representation template 5.' + drTemplate);
  }

  // Expand through bitmap: absent points become NaN.
  let data;
  if (bitmap) {
    data = new Float32Array(ndata).fill(NaN);
    const { bytes, offset } = bitmap;
    let k = 0;
    for (let i = 0; i < ndata; i++) {
      if (bytes[offset + (i >> 3)] & (0x80 >> (i & 7))) data[i] = vals[k++];
    }
  } else {
    data = vals;
  }

  return { grid, data };
}

if (typeof module !== 'undefined') module.exports = { decodeGrib2 };
