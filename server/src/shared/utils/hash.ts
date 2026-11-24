import { createHash, randomBytes } from 'node:crypto';

/** Generate a cryptographically random hex token */
export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

/** SHA-256 hash a token for storage */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
