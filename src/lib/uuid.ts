// UUID v4 generator with no native dependency.
//
// Uses the platform CSPRNG (crypto.getRandomValues) when it exists, otherwise falls back
// to Math.random. These IDs are row identifiers, not secrets: access control is done by
// Row Level Security, and the database primary key rejects any duplicate.
type RandomSource = { getRandomValues?: (a: Uint8Array) => Uint8Array };

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c = (globalThis as { crypto?: RandomSource }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
