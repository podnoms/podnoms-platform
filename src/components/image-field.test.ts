import { describe, expect, it } from 'vitest'
import { imageIdToSave } from '~/components/image-field'

describe('imageIdToSave', () => {
  it('maps the field state to the imageId the edit schemas expect', () => {
    expect(imageIdToSave({ kind: 'keep' })).toBeUndefined()
    expect(imageIdToSave({ kind: 'remove' })).toBeNull()
    expect(imageIdToSave({ kind: 'uploaded', previewUrl: 'blob:x', imageId: 'id-1' })).toBe('id-1')
    // Saving mid-upload keeps the current image rather than a half-uploaded one.
    expect(imageIdToSave({ kind: 'uploading', previewUrl: 'blob:x', abort: () => {} })).toBeUndefined()
  })
})
