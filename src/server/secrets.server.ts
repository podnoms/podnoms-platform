// Secrets kept in the database (authenticator app secrets, the SMTP password)
// are encrypted with a key derived from AUTH_SECRET, so a copy of the database
// alone doesn't give them away. Each kind gets its own key, named by its
// purpose. Changing AUTH_SECRET makes them all unreadable.
import '@tanstack/react-start/server-only'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { env } from '~/env'

export type SecretPurpose = 'podnoms totp secret' | 'podnoms smtp password'

const keys = new Map<SecretPurpose, Buffer>()

function keyFor(purpose: SecretPurpose) {
  let key = keys.get(purpose)
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', env.AUTH_SECRET, '', purpose, 32))
    keys.set(purpose, key)
  }
  return key
}

// Stored as "<iv>.<auth tag>.<ciphertext>", each base64url-encoded.
export function encryptSecret(purpose: SecretPurpose, plaintext: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFor(purpose), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

// Throws if the value wasn't encrypted for this purpose with this AUTH_SECRET.
export function decryptSecret(purpose: SecretPurpose, stored: string) {
  const [iv, tag, ciphertext] = stored.split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', keyFor(purpose), iv!)
  decipher.setAuthTag(tag!)
  return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString('utf8')
}
