import { App, PluginSettingTab, Setting } from 'obsidian'
import { onSsoReceive } from '~/events/sso-receive'
import i18n from '~/i18n'
import type NutstorePlugin from '~/index'
import { ConflictStrategy } from '~/sync/tasks/conflict-resolve.task'
import { runAsync } from '~/utils/async-helpers'
import { GlobMatchOptions } from '~/utils/glob-match'
import waitUntil from '~/utils/wait-until'
import AccountSettings from './account'
import CacheSettings from './cache'
import CommonSettings from './common'
import FilterSettings from './filter'
import LogSettings from './log'
import AISettings from './ai'
import { AIProviderConfigs } from '~/ai/types'

export enum SyncMode {
	STRICT = 'strict',
	LOOSE = 'loose',
}

export interface NutstoreSettings {
	account: string
	credential: string
	remoteDir: string
	remoteCacheDir?: string
	useGitStyle: boolean
	conflictStrategy: ConflictStrategy
	oauthResponseText: string
	loginMode: 'manual' | 'sso'
	confirmBeforeSync: boolean
	confirmBeforeDeleteInAutoSync: boolean
	syncMode: SyncMode
	filterRules: {
		exclusionRules: GlobMatchOptions[]
		inclusionRules: GlobMatchOptions[]
	}
	skipLargeFiles: {
		maxSize: string
	}
	realtimeSync: boolean
	startupSyncDelaySeconds: number
	autoSyncIntervalSeconds: number
	language?: 'zh' | 'en'
	ai: {
		providers: AIProviderConfigs
		defaultModel?: { providerId: string; modelId: string }
		yolo?: boolean
	}
	configDirSyncMode?: 'none' | 'bookmarks' | 'all'
}

let pluginInstance: NutstorePlugin | null = null

export function setPluginInstance(plugin: NutstorePlugin | null) {
	pluginInstance = plugin
}

export function waitUntilPluginInstance() {
	return waitUntil(() => !!pluginInstance, 100)
}

export async function useSettings() {
	await waitUntilPluginInstance()
	return pluginInstance!.settings
}

export class NutstoreSettingTab extends PluginSettingTab {
	plugin: NutstorePlugin
	accountSettings: AccountSettings
	commonSettings: CommonSettings
	filterSettings: FilterSettings
	logSettings: LogSettings
	cacheSettings: CacheSettings
	aiSettings: AISettings
	warningContainerEl: HTMLElement

	subSso = onSsoReceive().subscribe(() => {
		runAsync(() => this.display())
	})

	constructor(app: App, plugin: NutstorePlugin) {
		super(app, plugin)
		this.plugin = plugin
		this.warningContainerEl = this.containerEl.createDiv()
		this.accountSettings = new AccountSettings(
			this.app,
			this.plugin,
			this,
			this.containerEl.createDiv(),
		)
		this.commonSettings = new CommonSettings(
			this.app,
			this.plugin,
			this,
			this.containerEl.createDiv(),
		)
		this.filterSettings = new FilterSettings(
			this.app,
			this.plugin,
			this,
			this.containerEl.createDiv(),
		)
		this.cacheSettings = new CacheSettings(
			this.app,
			this.plugin,
			this,
			this.containerEl.createDiv(),
		)
		this.aiSettings = new AISettings(
			this.app,
			this.plugin,
			this,
			this.containerEl.createDiv(),
		)
		this.logSettings = new LogSettings(
			this.app,
			this.plugin,
			this,
			this.containerEl.createDiv(),
		)
	}

	display() {
		runAsync(() => {
			this.warningContainerEl.empty()
			new Setting(this.warningContainerEl)
				.setName(i18n.t('settings.backupWarning.name'))
				.setDesc(i18n.t('settings.backupWarning.desc'))
			this.accountSettings.display()
			this.commonSettings.display()
			this.filterSettings.display()
			this.cacheSettings.display()
			this.aiSettings.display()
			this.logSettings.display()
		})
	}

	get isSSO() {
		return this.plugin.settings.loginMode === 'sso'
	}

	hide() {
		this.accountSettings.hide()
	}
}