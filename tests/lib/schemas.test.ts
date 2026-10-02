import { describe, expect, it } from 'vitest'
import { credentialsSchema } from '~/lib/auth-schema'
import {
  editEpisodeSchema,
  linkEpisodeSchema,
  newEpisodeSchema,
  uploadEpisodeSchema,
} from '~/lib/episode-schema'
import { loginSearchSchema } from '~/lib/login-search'
import { editPodcastSchema, newPodcastSchema } from '~/lib/podcast-schema'
import { recoveryCodeSchema, secondFactorSchema, securityKeyNameSchema, totpCodeSchema } from '~/lib/two-factor-schema'

const uuid = '0b6f4a3e-7a3c-4d1e-9f2a-1c2b3d4e5f60'

function firstError(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message
}

describe('credentialsSchema', () => {
  it('trims and lowercases the email', () => {
    expect(credentialsSchema.parse({ email: '  Me@Example.COM ', password: 'password1' })).toEqual({
      email: 'me@example.com',
      password: 'password1',
    })
  })

  it('rejects invalid emails', () => {
    expect(firstError(credentialsSchema.safeParse({ email: 'nope', password: 'password1' }))).toBe(
      'Enter a valid email address',
    )
  })

  it('requires passwords of 8 to 200 characters', () => {
    expect(firstError(credentialsSchema.safeParse({ email: 'a@b.co', password: 'short' }))).toBe(
      'Password must be at least 8 characters',
    )
    expect(credentialsSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(201) }).success).toBe(false)
    expect(credentialsSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(200) }).success).toBe(true)
  })
})

describe('newPodcastSchema', () => {
  it('trims the title and drops a blank description', () => {
    expect(newPodcastSchema.parse({ title: '  My Show ', description: '   ' })).toEqual({
      title: 'My Show',
      description: undefined,
    })
  })

  it('requires a title of at most 100 characters', () => {
    expect(firstError(newPodcastSchema.safeParse({ title: '   ' }))).toBe('Give your podcast a title')
    expect(firstError(newPodcastSchema.safeParse({ title: 'x'.repeat(101) }))).toBe(
      'Keep the title under 100 characters',
    )
  })

  it('limits the description to 4000 characters', () => {
    expect(newPodcastSchema.safeParse({ title: 't', description: 'x'.repeat(4001) }).success).toBe(false)
  })
})

describe('editPodcastSchema', () => {
  it('accepts an image ID, null to remove, or nothing to keep', () => {
    expect(editPodcastSchema.parse({ id: 'p1', title: 'T', imageId: uuid }).imageId).toBe(uuid)
    expect(editPodcastSchema.parse({ id: 'p1', title: 'T', imageId: null }).imageId).toBeNull()
    expect(editPodcastSchema.parse({ id: 'p1', title: 'T' }).imageId).toBeUndefined()
  })

  it('rejects image IDs that are not UUIDs', () => {
    expect(editPodcastSchema.safeParse({ id: 'p1', title: 'T', imageId: '../../etc/passwd' }).success).toBe(false)
  })

  it('limits the HTML description to 20000 characters', () => {
    expect(editPodcastSchema.safeParse({ id: 'p1', title: 'T', description: 'x'.repeat(20001) }).success).toBe(
      false,
    )
  })
})

describe('linkEpisodeSchema', () => {
  it('accepts a link and makes blank details undefined', () => {
    expect(
      linkEpisodeSchema.parse({ podcastId: 'p1', sourceUrl: ' https://youtu.be/x ', title: ' ', description: '' }),
    ).toEqual({ podcastId: 'p1', sourceUrl: 'https://youtu.be/x', title: undefined, description: undefined })
  })

  it('explains what is wrong with the link', () => {
    expect(firstError(linkEpisodeSchema.safeParse({ podcastId: 'p1', sourceUrl: '' }))).toBe(
      'Paste a link to the video or audio',
    )
    expect(firstError(linkEpisodeSchema.safeParse({ podcastId: 'p1', sourceUrl: 'youtube' }))).toBe(
      'Enter a full link, starting with https://',
    )
  })
})

describe('uploadEpisodeSchema', () => {
  it('requires an upload UUID', () => {
    expect(uploadEpisodeSchema.parse({ podcastId: 'p1', uploadId: uuid }).uploadId).toBe(uuid)
    expect(firstError(uploadEpisodeSchema.safeParse({ podcastId: 'p1', uploadId: 'x' }))).toBe(
      'Choose an audio file to upload',
    )
  })
})

describe('newEpisodeSchema', () => {
  it('accepts either a link or an upload', () => {
    expect(newEpisodeSchema.parse({ podcastId: 'p1', sourceUrl: 'https://a.test/v' })).toHaveProperty('sourceUrl')
    expect(newEpisodeSchema.parse({ podcastId: 'p1', uploadId: uuid })).toHaveProperty('uploadId')
    expect(newEpisodeSchema.safeParse({ podcastId: 'p1' }).success).toBe(false)
  })
})

describe('editEpisodeSchema', () => {
  it('requires a title', () => {
    expect(firstError(editEpisodeSchema.safeParse({ id: 'e1', title: '' }))).toBe('Give the episode a title')
    expect(editEpisodeSchema.parse({ id: 'e1', title: ' T ' }).title).toBe('T')
  })
})

describe('loginSearchSchema', () => {
  it('reads the login and authError params', () => {
    expect(loginSearchSchema.parse({ login: true })).toEqual({ login: true })
    expect(loginSearchSchema.parse({ login: 'signup', authError: 'CredentialsSignin' })).toEqual({
      login: 'signup',
      authError: 'CredentialsSignin',
    })
  })

  it('ignores invalid values rather than failing', () => {
    expect(loginSearchSchema.parse({ login: 'yes', authError: 42 })).toEqual({
      login: undefined,
      authError: undefined,
    })
  })
})

describe('totpCodeSchema', () => {
  it('accepts six digits, ignoring spaces', () => {
    expect(totpCodeSchema.parse('123 456')).toBe('123456')
  })

  it('rejects anything else', () => {
    for (const code of ['12345', '1234567', 'abcdef']) {
      expect(firstError(totpCodeSchema.safeParse(code))).toBe('Enter the 6-digit code from your app')
    }
  })
})

describe('recoveryCodeSchema', () => {
  it('accepts codes with or without the dash, in any case', () => {
    expect(recoveryCodeSchema.parse(' abcde-fgh23 ')).toBe('abcde-fgh23')
    expect(recoveryCodeSchema.safeParse('ABCDEFGH23').success).toBe(true)
  })

  it('rejects malformed codes', () => {
    expect(recoveryCodeSchema.safeParse('abcde-fgh21').success).toBe(false)
    expect(recoveryCodeSchema.safeParse('abcd').success).toBe(false)
  })
})

describe('securityKeyNameSchema', () => {
  it('needs a name of up to 60 characters', () => {
    expect(securityKeyNameSchema.parse('  YubiKey ')).toBe('YubiKey')
    expect(firstError(securityKeyNameSchema.safeParse(' '))).toBe('Give the key a name')
    expect(securityKeyNameSchema.safeParse('x'.repeat(61)).success).toBe(false)
  })
})

describe('secondFactorSchema', () => {
  it('takes a code or a security key response', () => {
    expect(secondFactorSchema.parse({ method: 'totp', code: '123456' })).toEqual({ method: 'totp', code: '123456' })
    const response = { id: 'abc', rawId: 'abc', type: 'public-key', response: { signature: 'x' }, clientExtensionResults: {} }
    expect(secondFactorSchema.parse({ method: 'securityKey', response })).toEqual({ method: 'securityKey', response })
  })

  it('rejects something that is not a credential', () => {
    expect(secondFactorSchema.safeParse({ method: 'securityKey', response: { id: 'abc' } }).success).toBe(false)
    expect(secondFactorSchema.safeParse({ method: 'password', code: 'x' }).success).toBe(false)
  })
})
