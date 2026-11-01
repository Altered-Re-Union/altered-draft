import { afterEach, describe, expect, it, vi } from 'vitest'
import { canNativeShare, nativeShare, tournamentShareUrl } from './share.js'
afterEach(() => vi.unstubAllGlobals())
it('tournamentShareUrl builds the absolute page URL', () => {
  expect(tournamentShareUrl('abc', 'https://altered-draft.altered.re')).toBe('https://altered-draft.altered.re/tournament/t/abc')
})
it('native share: unsupported here, supported with navigator.share, false on AbortError', async () => {
  expect(canNativeShare()).toBe(false)
  expect(await nativeShare({ title: 'x', url: 'https://x.test' })).toBe(false)
  const share = vi.fn(async () => {})
  vi.stubGlobal('navigator', { share })
  expect(canNativeShare()).toBe(true)
  expect(await nativeShare({ title: 'x', url: 'https://x.test' })).toBe(true)
  expect(share).toHaveBeenCalledWith({ title: 'x', url: 'https://x.test' })
  vi.stubGlobal('navigator', { share: async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) } })
  expect(await nativeShare({ title: 'x', url: 'https://x.test' })).toBe(false)
})
