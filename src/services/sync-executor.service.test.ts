import { beforeEach, describe, expect, it, vi } from 'vitest'

const { startMock, nutstoreSyncCtor } = vi.hoisted(() => ({
	startMock: vi.fn(),
	nutstoreSyncCtor: vi.fn(),
}))

vi.mock('~/sync', () => ({
	SyncStartMode: {
		AUTO_SYNC: 'auto_sync',
		MANUAL_SYNC: 'manual_sync',
	},
	NutstoreSync: nutstoreSyncCtor.mockImplementation(() => ({
		start: startMock,
	})),
}))

import { SyncStartMode } from '~/sync'
import SyncExecutorService from './sync-executor.service'

function createPlugin(): any {
	return {
		isSyncing: false,
		manifest: {
			id: 'guozha-ai-pro',
		},
		isAccountConfigured: vi.fn(() => true),
		getToken: vi.fn(async () => 'token'),
		remoteBaseDir: '/remote',
		app: {
			vault: {
				getName: vi.fn(() => 'vault'),
			},
			setting: {
				open: vi.fn(),
				openTabById: vi.fn(),
			},
		},
		webDAVService: {
			createWebDAVClient: vi.fn(async () => ({ client: true })),
		},
	}
}

describe('SyncExecutorService', () => {
	beforeEach(() => {
		startMock.mockReset()
		nutstoreSyncCtor.mockClear()
	})

	it('delegates directly to NutstoreSync.start and returns its result', async () => {
		startMock.mockResolvedValue(true)
		const plugin = createPlugin()
		const service = new SyncExecutorService(plugin)

		await expect(
			service.executeSync({ mode: SyncStartMode.AUTO_SYNC }),
		).resolves.toBe(true)

		expect(nutstoreSyncCtor).toHaveBeenCalledTimes(1)
		expect(startMock).toHaveBeenCalledWith({ mode: SyncStartMode.AUTO_SYNC })
	})

	it('returns false without constructing sync when account is not configured', async () => {
		const plugin = {
			...createPlugin(),
			isAccountConfigured: vi.fn(() => false),
		} as never
		const service = new SyncExecutorService(plugin)

		await expect(
			service.executeSync({ mode: SyncStartMode.AUTO_SYNC }),
		).resolves.toBe(false)

		expect(nutstoreSyncCtor).not.toHaveBeenCalled()
		expect(startMock).not.toHaveBeenCalled()
	})

	it('rethrows unexpected sync setup errors', async () => {
		const error = new Error('Failed to create token')
		const plugin = {
			...createPlugin(),
			getToken: vi.fn(async () => {
				throw error
			}),
		}
		const service = new SyncExecutorService(plugin)

		await expect(
			service.executeSync({ mode: SyncStartMode.MANUAL_SYNC }),
		).rejects.toThrow(error)

		expect(nutstoreSyncCtor).not.toHaveBeenCalled()
	})
})