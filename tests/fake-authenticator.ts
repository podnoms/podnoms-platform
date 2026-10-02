// A software security key for WebAuthn tests: it answers registration and
// authentication requests the way a real key (with "none" attestation) does.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

// Just enough CBOR for attestation objects and COSE keys.
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>

function cborHead(major: number, length: number) {
  if (length < 24) return [(major << 5) | length]
  if (length < 0x100) return [(major << 5) | 24, length]
  return [(major << 5) | 25, length >> 8, length & 0xff]
}

function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') {
    return Buffer.from(value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value))
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8')
    return Buffer.concat([Buffer.from(cborHead(3, bytes.length)), bytes])
  }
  if (value instanceof Uint8Array) return Buffer.concat([Buffer.from(cborHead(2, value.length)), value])
  const parts = [...value].flatMap(([k, v]) => [cbor(k), cbor(v)])
  return Buffer.concat([Buffer.from(cborHead(5, value.size)), ...parts])
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest()

function uint32(n: number) {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(n)
  return bytes
}

export function fakeSecurityKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const credentialId = randomBytes(32)
  let signCount = 0

  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))

  return {
    id: b64url(credentialId),

    register(options: PublicKeyCredentialCreationOptionsJSON, origin: string): RegistrationResponseJSON {
      const coseKey = new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ])
      const authData = Buffer.concat([
        sha256(options.rp.id!),
        Buffer.from([0x41]), // user present, attested credential data included
        uint32(signCount),
        Buffer.alloc(16), // AAGUID
        Buffer.from([credentialId.length >> 8, credentialId.length & 0xff]),
        credentialId,
        cbor(coseKey),
      ])
      const attestationObject = cbor(
        new Map<Cbor, Cbor>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      )
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientData('webauthn.create', options.challenge, origin)),
          attestationObject: b64url(attestationObject),
          transports: ['usb'],
        },
        clientExtensionResults: {},
      }
    },

    authenticate(options: PublicKeyCredentialRequestOptionsJSON, origin: string): AuthenticationResponseJSON {
      signCount += 1
      const authData = Buffer.concat([sha256(options.rpId!), Buffer.from([0x01]), uint32(signCount)])
      const clientDataJSON = clientData('webauthn.get', options.challenge, origin)
      const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), privateKey)
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientDataJSON),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
        },
        clientExtensionResults: {},
      }
    },
  }
}
