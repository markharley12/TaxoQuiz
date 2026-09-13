/**
 * Shareable game seeds. Port of `taxoquiz/game/seed.py`, which explains the
 * format and why a seed fingerprints its dataset.
 *
 * This is the module where a near miss costs most. A seed shared from the
 * website must open the same animal on a phone, and the two now compute it
 * independently — so the hashing is byte-for-byte Python's, including treating
 * the whole 256-bit digest as one integer, which is what `BigInt` is for.
 */
import { sha256 } from './sha256'
import type { RawNode } from './taxonomy'

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const FINGERPRINT_LEN = 4
export const BODY_LEN = 6

const utf8 = new TextEncoder()

function digestInt(text: string): bigint {
  let n = 0n
  for (const byte of sha256(utf8.encode(text))) n = (n << 8n) | BigInt(byte)
  return n
}

function encode(n: bigint, length: number): string {
  const base = BigInt(ALPHABET.length)
  const out: string[] = []
  for (let i = 0; i < length; i++) {
    out.push(ALPHABET[Number(n % base)])
    n /= base
  }
  return out.reverse().join('')
}

export function fingerprint(species: RawNode[]): string {
  return encode(digestInt(species.map((s) => `${s.common_name}\n`).join('')), FINGERPRINT_LEN)
}

/** `isoDay` is `YYYY-MM-DD`. */
export function bodyForDate(isoDay: string): string {
  return encode(digestInt(`taxoquiz-daily:${isoDay}`), BODY_LEN)
}

/** Today in UTC — the same date `App.tsx` stamps a saved session with, so a
 *  daily round and the check that expires it agree on when the day ends. */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function newBody(): string {
  // 256 is a multiple of 32, so a byte modulo the alphabet is unbiased.
  const bytes = crypto.getRandomValues(new Uint8Array(BODY_LEN))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function makeSeed(species: RawNode[], opts: { body?: string; day?: string } = {}): string {
  const body = opts.day !== undefined ? bodyForDate(opts.day) : opts.body
  return `${fingerprint(species)}-${body || newBody()}`
}

/** Accept what a person actually types: any case, spaces, missing dash. */
export function normalise(seed: string): string {
  const cleaned = [...seed.toUpperCase()].filter((c) => ALPHABET.includes(c)).join('')
  if (cleaned.length !== FINGERPRINT_LEN + BODY_LEN) {
    throw new Error(
      `'${seed}' is not a seed — expected ${FINGERPRINT_LEN + BODY_LEN} characters like ABCD-234567.`,
    )
  }
  return `${cleaned.slice(0, FINGERPRINT_LEN)}-${cleaned.slice(FINGERPRINT_LEN)}`
}

export function resolve(seed: string, species: RawNode[]): RawNode {
  seed = normalise(seed)
  const [fp, body] = seed.split('-')
  const expected = fingerprint(species)
  if (fp !== expected) {
    throw new Error(
      `Seed '${seed}' is for a different dataset (its tag is ${fp}, this one is ${expected}). ` +
      'Both players need the same dataset.',
    )
  }
  return species[Number(digestInt(`taxoquiz-seed:${body}`) % BigInt(species.length))]
}
