import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '~/server/secrets.server'

describe('secrets', () => {
  it('round-trips, never storing the plain text', () => {
    const stored = encryptSecret('podnoms smtp password', 'hunter2')
    expect(stored).not.toContain('hunter2')
    expect(decryptSecret('podnoms smtp password', stored)).toBe('hunter2')
  })

  it('encrypts the same text differently each time', () => {
    expect(encryptSecret('podnoms smtp password', 'x')).not.toBe(encryptSecret('podnoms smtp password', 'x'))
  })

  it("can't read one purpose's secret with another's key", () => {
    const stored = encryptSecret('podnoms smtp password', 'hunter2')
    expect(() => decryptSecret('podnoms totp secret', stored)).toThrow()
  })

  // Authenticator secrets were encrypted before this module existed; they must still read.
  it('reads authenticator secrets encrypted the way two-factor.server.ts used to', () => {
    const key = Buffer.from(hkdfSync('sha256', process.env.AUTH_SECRET!, '', 'podnoms totp secret', 32))
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update('JBSWY3DPEHPK3PXP', 'utf8'), cipher.final()])
    const stored = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
    expect(decryptSecret('podnoms totp secret', stored)).toBe('JBSWY3DPEHPK3PXP')
  })
})
