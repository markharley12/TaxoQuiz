/**
 * SHA-256, synchronous and in plain TypeScript.
 *
 * Seeds are a hash over the species list, so the client has to compute exactly
 * what `hashlib.sha256` does. The browser's own `crypto.subtle.digest` would be
 * the obvious choice and is the wrong one here, for two reasons:
 *
 * - **It only exists in a secure context.** The dev server is reached from a
 *   phone over plain http on a Tailscale address, where `crypto.subtle` is
 *   undefined — the game would start on a laptop and fail on the phone.
 * - **It is async**, which would make every pure function above it async too,
 *   for no reason other than this one call.
 *
 * Checked against Python's digests at every padding boundary in
 * `conformance.test.ts`.
 */

function firstPrimes(count: number): number[] {
  const out: number[] = []
  for (let n = 2; out.length < count; n++) {
    if (out.every((p) => n % p !== 0)) out.push(n)
  }
  return out
}

/** The first 32 bits of a number's fractional part. */
const frac32 = (x: number) => ((x - Math.floor(x)) * 0x100000000) >>> 0

// Derived rather than pasted: the constants are defined as these roots, and a
// typo in a 64-entry table of hex fails silently in exactly one digest in four
// billion. Double precision leaves ~20 bits of margin below the 32 kept.
const PRIMES = firstPrimes(64)
const K = Uint32Array.from(PRIMES, (p) => frac32(Math.cbrt(p)))
const H0 = Uint32Array.from(PRIMES.slice(0, 8), (p) => frac32(Math.sqrt(p)))

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

export function sha256(data: Uint8Array): Uint8Array {
  const blocks = Math.ceil((data.length + 9) / 64)
  const padded = new Uint8Array(blocks * 64)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  // Message length in bits, as a 64-bit big-endian integer.
  view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000))
  view.setUint32(padded.length - 4, (data.length << 3) >>> 0)

  const h = H0.slice()
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4)
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15], b = w[t - 2]
      w[t] = (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))
        + w[t - 7]
        + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3))
        + w[t - 16]
    }

    let [a, b, c, d, e, f, g, hh] = h
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g; g = f; f = e
      e = (d + t1) >>> 0
      d = c; c = b; b = a
      a = (t1 + t2) >>> 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d
    h[4] += e; h[5] += f; h[6] += g; h[7] += hh
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  h.forEach((word, i) => outView.setUint32(i * 4, word))
  return out
}
