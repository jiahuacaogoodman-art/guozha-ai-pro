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

	it('opens settings and returns false when the local build lacks Nutstore SSO', async () => {
		const plugin = {
			...createPlugin(),
			getToken: vi.fn(async () => {
				throw new Error(
					'This local build does not include Nutstore SSO. Use manual WebDAV login in plugin settings.',
				)
			}),
		}
		const service = new SyncExecutorService(plugin)

		await expect(
			service.executeSync({ mode: SyncStartMode.MANUAL_SYNC }),
		).resolves.toBe(false)

		expect(nutstoreSyncCtor).not.toHaveBeenCalled()
		expect(plugin.app.setting.open).toHaveBeenCalledTimes(1)
		expect(plugin.app.setting.openTabById).toHaveBeenCalledWith('guozha-ai-pro')
	})
})
