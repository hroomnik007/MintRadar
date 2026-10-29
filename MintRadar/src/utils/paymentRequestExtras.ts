// Two NUT-18 / NUT-26 fields that cashu-ts 4.12.0 drops while decoding (for creqA and for creqB): the mint-list flag `mp`
// (NUT-26 tag 0x09) and the supported payment methods `sm` with their fee `mf` (tag 0x0a, sub-tags 0x01 method and 0x02
// fee). This module reads ONLY those two fields from the pasted string, with its own small bech32m, TLV and CBOR readers.
// It never throws, it has no effect on the cashu-ts decode (that stays the single source of every other field), and
// anything it cannot read, or does not support, gives nulls. If a later cashu-ts exposes these fields, delete this file
// and read them from `PaymentRequest` instead (see docs/claude/tools-page.md, "Payment request inspector").
//
// Bounds: the caller's length caps (4096 characters, creqB 1023), CBOR depth 8, 32 methods, 32 bytes per method name.
// Every declared length is checked against the bytes that are left BEFORE anything is read or allocated for it, and every
// loop consumes at least one byte, so the work is proportional to the input and nothing is allocated from a declared size.

export interface PaymentRequestMethod {
  method: string
  /** In the request's unit; null when the request leaves it out (the spec reads that as 0). */
  fee: bigint | null
}

export interface PaymentRequestExtras {
  /** `mp`: true = the mint list is preferred, not strict. false = strict (the default). null = absent or unreadable. */
  mintPreferred: boolean | null
  /** `sm`: null = absent or unreadable. An empty list can come back (a request that lists none). */
  supportedMethods: PaymentRequestMethod[] | null
}

export const NO_EXTRAS: PaymentRequestExtras = { mintPreferred: null, supportedMethods: null }

export const EXTRAS_MAX_LENGTH = 4096
export const EXTRAS_CREQB_MAX_LENGTH = 1023
export const EXTRAS_MAX_CBOR_DEPTH = 8
export const EXTRAS_MAX_METHODS = 32
export const EXTRAS_MAX_METHOD_BYTES = 32

class Unsupported extends Error {}
const bad = (): never => { throw new Unsupported() }

// ---------------------------------------------------------------- bech32m (BIP-350), HRP "creqb" only

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32M_CONST = 0x2bc830a3
const HRP = 'creqb'

function polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i]!
  }
  return chk >>> 0
}

/** The data bytes of a `creqb1…` string (any case, as NUT-26 requires), or null when the checksum or the padding is wrong. */
function bech32mBytes(text: string): Uint8Array | null {
  const s = text.toLowerCase()
  if (!s.startsWith(`${HRP}1`)) return null
  const words: number[] = []
  for (const c of s.slice(HRP.length + 1)) {
    const w = CHARSET.indexOf(c)
    if (w < 0) return null
    words.push(w)
  }
  if (words.length < 6) return null
  const hrpExpanded = [...HRP].map(c => c.charCodeAt(0) >> 5).concat(0, [...HRP].map(c => c.charCodeAt(0) & 31))
  if (polymod([...hrpExpanded, ...words]) !== BECH32M_CONST) return null
  const out: number[] = []
  let acc = 0
  let bits = 0
  for (const w of words.slice(0, -6)) {
    acc = (acc << 5) | w
    bits += 5
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255) }
    acc &= (1 << bits) - 1
  }
  if (bits >= 5 || acc !== 0) return null
  return Uint8Array.from(out)
}

// ---------------------------------------------------------------- TLV (NUT-26): 1-byte type, 2-byte big-endian length

function tlvEntries(b: Uint8Array): { type: number; value: Uint8Array }[] {
  const out: { type: number; value: Uint8Array }[] = []
  let pos = 0
  while (pos < b.length) {
    if (b.length - pos < 3) bad()
    const len = (b[pos + 1]! << 8) | b[pos + 2]!
    if (len > b.length - pos - 3) bad()
    out.push({ type: b[pos]!, value: b.subarray(pos + 3, pos + 3 + len) })
    pos += 3 + len
  }
  return out
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

function methodName(v: Uint8Array): string {
  if (v.length === 0 || v.length > EXTRAS_MAX_METHOD_BYTES) bad()
  return utf8.decode(v)
}

function u64(v: Uint8Array): bigint {
  if (v.length !== 8) bad()
  return new DataView(v.buffer, v.byteOffset, 8).getBigUint64(0)
}

function extrasFromTlv(bytes: Uint8Array): PaymentRequestExtras {
  let mintPreferred: boolean | null = null
  let methods: PaymentRequestMethod[] | null = null
  for (const e of tlvEntries(bytes)) {
    if (e.type === 0x09) {
      mintPreferred = e.value.length === 1 && e.value[0]! <= 1 ? e.value[0] === 1 : null
    } else if (e.type === 0x0a) {
      methods ??= []
      if (methods.length >= EXTRAS_MAX_METHODS) bad()
      let method: string | null = null
      let fee: bigint | null = null
      for (const s of tlvEntries(e.value)) {
        if (s.type === 0x01) method = methodName(s.value)
        else if (s.type === 0x02) fee = u64(s.value)
      }
      if (method === null) bad()
      methods.push({ method: method!, fee })
    }
  }
  return { mintPreferred, supportedMethods: methods }
}

// ---------------------------------------------------------------- CBOR: maps, arrays, text, unsigned ints, booleans, null

class Cbor {
  private pos = 0
  constructor(private readonly b: Uint8Array) {}

  get done(): boolean { return this.pos >= this.b.length }
  private get left(): number { return this.b.length - this.pos }

  /** The initial byte split into major type and argument; indefinite lengths, reserved values and floats are refused. */
  private head(): { major: number; arg: bigint; info: number } {
    if (this.left < 1) bad()
    const first = this.b[this.pos++]!
    const major = first >> 5
    const info = first & 31
    if (info < 24) return { major, arg: BigInt(info), info }
    if (info > 27) return bad() // 28-30 reserved, 31 indefinite length
    const size = 1 << (info - 24)
    if (size > this.left) bad()
    let arg = 0n
    for (let i = 0; i < size; i++) arg = (arg << 8n) | BigInt(this.b[this.pos + i]!)
    this.pos += size
    return { major, arg, info }
  }

  /** A declared length (bytes or elements), checked against what is left before it is used for anything. */
  private count(arg: bigint, perItem: number): number {
    if (arg > BigInt(this.left) / BigInt(perItem)) bad()
    return Number(arg)
  }

  private text(len: number): string {
    const s = utf8.decode(this.b.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }

  /** A text string no longer than `maxBytes`. */
  readText(maxBytes: number): string {
    const { major, arg } = this.head()
    if (major !== 3) bad()
    const len = this.count(arg, 1)
    if (len > maxBytes) bad()
    return this.text(len)
  }

  readUint(): bigint {
    const { major, arg } = this.head()
    if (major !== 0) bad()
    return arg
  }

  readBool(): boolean | null {
    if (this.left < 1) bad()
    const first = this.b[this.pos]!
    if (first !== 0xf4 && first !== 0xf5) return null
    this.pos++
    return first === 0xf5
  }

  /** Header of a map: its number of entries. */
  mapSize(): number {
    const { major, arg } = this.head()
    if (major !== 5) bad()
    return this.count(arg, 2)
  }

  arraySize(): number {
    const { major, arg } = this.head()
    if (major !== 4) bad()
    return this.count(arg, 1)
  }

  /** Steps over one value of any supported kind. */
  skip(depth: number): void {
    if (depth > EXTRAS_MAX_CBOR_DEPTH) bad()
    const { major, arg, info } = this.head()
    switch (major) {
      case 0: case 1: return
      case 2: case 3: this.pos += this.count(arg, 1); return
      case 4: { const n = this.count(arg, 1); for (let i = 0; i < n; i++) this.skip(depth + 1); return }
      case 5: { const n = this.count(arg, 2); for (let i = 0; i < 2 * n; i++) this.skip(depth + 1); return }
      case 7: if (info >= 20 && info <= 22) return; return bad() // false, true, null; floats and other simple values are refused
      default: return bad() // 6: tags
    }
  }
}

function extrasFromCbor(bytes: Uint8Array): PaymentRequestExtras {
  const c = new Cbor(bytes)
  let mintPreferred: boolean | null = null
  let methods: PaymentRequestMethod[] | null = null
  const entries = c.mapSize()
  for (let i = 0; i < entries; i++) {
    const key = c.readText(64)
    if (key === 'mp') {
      mintPreferred = c.readBool()
      if (mintPreferred === null) c.skip(1)
    } else if (key === 'sm') {
      methods = readMethods(c)
    } else {
      c.skip(1)
    }
  }
  return { mintPreferred, supportedMethods: methods }
}

function readMethods(c: Cbor): PaymentRequestMethod[] {
  const n = c.arraySize()
  if (n > EXTRAS_MAX_METHODS) bad()
  const out: PaymentRequestMethod[] = []
  for (let i = 0; i < n; i++) {
    let method: string | null = null
    let fee: bigint | null = null
    const fields = c.mapSize()
    for (let j = 0; j < fields; j++) {
      const key = c.readText(64)
      if (key === 'mn') method = c.readText(EXTRAS_MAX_METHOD_BYTES)
      else if (key === 'mf') fee = c.readUint()
      else c.skip(3)
    }
    if (method === null || method === '') bad()
    out.push({ method: method!, fee })
  }
  return out
}

function base64Bytes(payload: string): Uint8Array {
  const clean = payload.replace(/=+$/, '')
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) bad()
  const bin = atob(clean.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(clean.length / 4) * 4, '='))
  return Uint8Array.from(bin, ch => ch.charCodeAt(0))
}

/**
 * The `mp` flag and the `sm` list of a pasted payment request. Input is the pasted string (trimmed here). Any failure,
 * an unsupported CBOR feature, a bound that is exceeded, or a string that is neither creqA nor creqB gives nulls.
 */
export function readPaymentRequestExtras(raw: string): PaymentRequestExtras {
  try {
    const text = raw.trim()
    if (text.length > EXTRAS_MAX_LENGTH) return NO_EXTRAS
    const head = text.slice(0, 6).toLowerCase()
    if (head === 'creqb1') {
      if (text.length > EXTRAS_CREQB_MAX_LENGTH) return NO_EXTRAS
      const bytes = bech32mBytes(text)
      return bytes ? extrasFromTlv(bytes) : NO_EXTRAS
    }
    if (head.startsWith('creqa')) {
      return extrasFromCbor(base64Bytes(text.slice(5)))
    }
    return NO_EXTRAS
  } catch {
    return NO_EXTRAS
  }
}
