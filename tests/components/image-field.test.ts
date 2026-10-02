import { describe, expect, it } from 'vitest'
import { imageFromClipboard, imageIdToSave } from '~/components/image-field'

describe('imageIdToSave', () => {
  it('maps the field state to the imageId the edit schemas expect', () => {
    expect(imageIdToSave({ kind: 'keep' })).toBeUndefined()
    expect(imageIdToSave({ kind: 'remove' })).toBeNull()
    expect(imageIdToSave({ kind: 'uploaded', previewUrl: 'blob:x', imageId: 'id-1' })).toBe('id-1')
    // Saving mid-upload keeps the current image rather than a half-uploaded one.
    expect(imageIdToSave({ kind: 'uploading', previewUrl: 'blob:x', abort: () => {} })).toBeUndefined()
  })
})

describe('imageFromClipboard', () => {
  const clipboard = (...files: File[]) => ({ files }) as unknown as DataTransfer

  it('finds a pasted image among the files', () => {
    const image = new File(['x'], 'image.png', { type: 'image/png' })
    expect(imageFromClipboard(clipboard(new File(['x'], 'notes.txt', { type: 'text/plain' }), image))).toBe(image)
  })

  it('returns null for text, other files or no clipboard, so they paste as usual', () => {
    expect(imageFromClipboard(clipboard())).toBeNull()
    expect(imageFromClipboard(clipboard(new File(['x'], 'notes.txt', { type: 'text/plain' })))).toBeNull()
    expect(imageFromClipboard(null)).toBeNull()
  })
})
