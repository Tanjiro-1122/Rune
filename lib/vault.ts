import { createDecipheriv, createCipheriv, randomBytes } from 'crypto';

const VAULT_KEY_B64 = process.env.VAULT_ENCRYPTION_KEY!;

function getKey(): Buffer {
  if (!VAULT_KEY_B64) throw new Error('VAULT_ENCRYPTION_KEY not set');
  return Buffer.from(VAULT_KEY_B64, 'base64');
}

export function decryptVaultPassword(encryptedB64: string, ivB64: string): string {
  try {
    const key = getKey();
    const iv = Buffer.from(ivB64, 'base64');
    const ciphertext = Buffer.from(encryptedB64, 'base64');
    // AES-256-GCM: last 16 bytes are auth tag
    const authTag = ciphertext.slice(-16);
    const encrypted = ciphertext.slice(0, -16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  } catch {
    return '••••••••';
  }
}

export function encryptVaultPassword(plaintext: string): { encrypted: string; iv: string } {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([encrypted, authTag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}
