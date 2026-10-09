import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'

// A name-based UUID (version 5, RFC 9562): the SHA-1 of the namespace and name,
// with the version and variant bits set.
export function uuidV5(name: string, namespace: string) {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replace(/-/g, ''), 'hex'))
    .update(name)
    .digest()
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
