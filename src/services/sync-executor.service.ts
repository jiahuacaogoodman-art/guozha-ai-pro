import { Notice } from 'obsidian'
import i18n from '~/i18n'
import { NutstoreSync, SyncStartMode } from '~/sync'
import { isNutstoreSsoUnavailableError } from '~/utils/decrypt-ticket-response'
import logger from '~/utils/logger'
import waitUntil from '~/utils/wait-until'
import type NutstorePlugin from '..'

export interface SyncOptions {
	mode: SyncStartMode
}

export default class SyncExecutorService {
	private inFlight = false

	constructor(private plugin: NutstorePlugin) {}

	async executeSync(options: SyncOptions) {
		if (this.inFlight || this.plugin.isSyncing) {
			return false
		}
		this.inFlight = true

		try {
			// 检查账号配置，未配置时静默返回（自动同步场景）
			if (!this.plugin.isAccountConfigured()) {
				return false
			}

			await waitUntil(() => this.plugin.isSyncing === false, 500)

			const sync = new NutstoreSync(this.plugin, {
				vault: this.plugin.app.vault,
				token: await this.plugin.getToken(),
				remoteBaseDir: this.plugin.remoteBaseDir,
				webdav: await this.plugin.webDAVService.createWebDAVClient(),
			})

			return await sync.start({
				mode: options.mode,
			})
		} catch (error) {
			logger.error(error)
			if (isNutstoreSsoUnavailableError(error)) {
				new Notice(i18n.t('settings.ssoStatus.unavailableNotice'), 8000)
				if (options.mode === SyncStartMode.MANUAL_SYNC) {
					this.openSettings()
				}
				return false
			}
			throw error
		} finally {
			this.inFlight = false
		}
	}

	private openSettings() {
		try {
			const setting = this.plugin.app.setting
			if (setting) {
				setting.open()
				setting.openTabById(this.plugin.manifest.id)
			}
		} catch (error) {
			logger.error('Failed to open settings:', error)
		}
	}
}
