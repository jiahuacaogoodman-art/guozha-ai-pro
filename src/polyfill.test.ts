import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PolyfillTestGlobal = Omit<typeof globalThis, 'process'> & {
	window: typeof globalThis
	process?: {
		cwd?: () => string
		env?: Record<string, string | undefined>
	}
}

const polyfillGlobal = globalThis as PolyfillTestGlobal
const originalProcess = polyfillGlobal.process

beforeEach(() => {
	vi.stubGlobal('window', polyfillGlobal)
})

afterEach(() => {
	polyfillGlobal.process = originalProcess
	vi.unstubAllGlobals()
	vi.resetModules()
})

describe('polyfill', () => {
	it('adds process.env when it is missing', async () => {
		polyfillGlobal.process = {
			cwd() {
				return '/mobile'
			},
		}

		vi.resetModules()
		await import('./polyfill')

		expect(polyfillGlobal.process).toBeDefined()
		expect(typeof polyfillGlobal.process?.cwd).toBe('function')
		expect(polyfillGlobal.process?.cwd?.()).toBe('/mobile')
		expect(polyfillGlobal.process?.env).toEqual({})
	})
})