// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { inPreview, isPreviewRequest, previewHeaders } from '~/lib/preview'

afterEach(() => window.history.replaceState(null, '', '/'))

describe("the visitor's view", () => {
  it('is on in a tab whose address asks for it', () => {
    expect([inPreview(), previewHeaders()]).toEqual([false, {}])
    window.history.replaceState(null, '', '/maker/show?preview=true')
    expect([inPreview(), previewHeaders()]).toEqual([true, { 'x-preview': '1' }])
  })

  it('is recognised in requests by their address or header', () => {
    expect(isPreviewRequest(new Request('https://podnoms.test/maker/show?preview=true'))).toBe(true)
    expect(isPreviewRequest(new Request('https://podnoms.test/_serverFn/x', { headers: { 'x-preview': '1' } }))).toBe(true)
    expect(isPreviewRequest(new Request('https://podnoms.test/maker/show?preview=false'))).toBe(false)
    expect(isPreviewRequest(new Request('https://podnoms.test/maker/show'))).toBe(false)
  })
})
