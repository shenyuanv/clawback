/**
 * Full-archive encryption/decryption using scrypt + AES-256-GCM.
 * Same crypto as credential vault, but operates on the entire archive buffer.
 * 
 * Encrypted archives start with a JSON header line followed by ciphertext.
 * Detection: first bytes are '{"v":2,' (v2 = full archive encryption).
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

const MAGIC = '{"v":2,';

/** scrypt parameters: N=2^17, r=8, p=1 (OWASP recommended minimum) */
const SCRYPT_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 131072 * 8 };

/**
 * Check if a buffer is an encrypted clawback archive.
 */
export function isEncryptedArchive(data: Buffer): boolean {
  return data.subarray(0, MAGIC.length).toString('utf-8') === MAGIC;
}

/**
 * Encrypt an archive buffer with a password.
 * Returns a buffer containing a JSON envelope with the encrypted data.
 */
export function encryptArchive(archive: Buffer, password: string): Buffer {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = scryptSync(password, salt, 32, SCRYPT_OPTIONS);

  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope = {
    v: 2,
    kdf: 'scrypt',
    alg: 'aes-256-gcm',
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
    size: archive.length,
    ciphertext: ciphertext.toString('base64'),
  };

  return Buffer.from(JSON.stringify(envelope), 'utf-8');
}

/**
 * Decrypt an encrypted archive buffer with a password.
 * Returns the original tar.gz buffer.
 */
export function decryptArchive(data: Buffer, password: string): Buffer {
  let envelope: {
    salt: string;
    nonce: string;
    tag: string;
    ciphertext: string;
  };

  try {
    envelope = JSON.parse(data.toString('utf-8'));
  } catch {
    throw new Error('Invalid encrypted archive format');
  }

  const salt = Buffer.from(envelope.salt, 'base64');
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const key = scryptSync(password, salt, 32, SCRYPT_OPTIONS);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Invalid password or corrupted encrypted archive');
  }
}
