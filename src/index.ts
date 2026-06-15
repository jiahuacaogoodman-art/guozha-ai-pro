import './polyfill'
import './webdav-patch'

import './assets/styles/global.css'

import { toBase64 } from 'js-base64'
import { normalizePath, Notice, Plugin } from 'obsidian'
import { sanitizeDefaultSelections, sanitizeProviders } from './ai/config'
import { SyncRibbonManager } from './components/SyncRibbonManager'
import { emitCancelSync } from './events'
import i18n from './i18n'
import ChatService from './services/chat.service'
import CommandService from './services/command.service'
import EventsService from './services/events.service'
import I18nService from './services/i18n.service'
import LoggerService from './services/logger.service'
import { ProgressService } from './services/progress.service'
import RealtimeSyncService from './services/realtime-sync.service'
import ScheduledSyncService from './services/scheduled-sync.service'
import { StatusService } from './services/status.service'
import SyncExecutorService from './services/sync-executor.service'
import { WebDAVService } from './services/webdav.service'
import {
	NutstoreSettings,
	NutstoreSettingTab,
	setPluginInstance,
	SyncMode,
} from './settings'
import { ConflictStrategy } from './sync/tasks/conflict-resolve.task'
import { GlobMatchOptions } from './utils/glob-match'
import logger from './utils/logger'
import { stdRemotePath } from './utils/std-remote-path'
import ChatboxView, { CHATBOX_VIEW_TYPE } from './views/chatbox.view'

export default class NutstorePlugin extends Plugin {
	public isSyncing: boolean = false
	public settings!: NutstoreSettings

	public commandService = new CommandService(this)
	public eventsService = new EventsService(this)
	public i18nService = new I18nService(this)
	public loggerService = new LoggerService(this)
	public progressService = new ProgressService(this)
	public ribbonManager = new SyncRibbonManager(this)
	public statusService = new StatusService(this)
	public webDAVService = new WebDAVService(this)
	public syncExecutorService = new SyncExecutorService(this)
	public chatService = new ChatService(this)
	public realtimeSyncService = new RealtimeSyncService(
		this,
		this.syncExecutorService,
	)
	public scheduledSyncService = new ScheduledSyncService(
		this,
		this.syncExecutorService,
	)

	async onload() {
		await this.loadSettings()
		await this.chatService.initialize()
		this.addSettingTab(new NutstoreSettingTab(this.app, this))
		this.registerView(CHATBOX_VIEW_TYPE, (leaf) => new ChatboxView(leaf, this))

		setPluginInstance(this)
		await this.chatService.handleSettingsChanged()

		await this.scheduledSyncService.start()
	}

	onunload() {
		setPluginInstance(null)
		emitCancelSync()
		this.scheduledSyncService.unload()
		this.progressService.unload()
		this.eventsService.unload()
		this.realtimeSyncService.unload()
		this.statusService.unload()
	}

	async loadSettings() {
		function createGlobMathOptions(expr: string) {
			return {
				expr,
				options: {
					caseSensitive: false,
				},
			} satisfies GlobMatchOptions
		}
		const exclusionRules = [
			'**/.git',
			'**/.github',
			'**/.gitlab',
			'**/.svn',
			'**/node_modules',
			'**/.DS_Store',
			'**/__MACOSX',
			'**/desktop.ini',
			'**/Thumbs.db',
			'**/.trash',
			'**/~$*.doc',
			'**/~$*.docx',
			'**/~$*.ppt',
			'**/~$*.pptx',
			'**/~$*.xls',
			'**/~$*.xlsx',
		].map(createGlobMathOptions)
		const DEFAULT_SETTINGS: NutstoreSettings = {
			account: '',
			credential: '',
			remoteDir: '',
			remoteCacheDir: '',
			useGitStyle: false,
			conflictStrategy: ConflictStrategy.DiffMatchPatch,
			oauthResponseText: '',
			loginMode: 'manual',
			confirmBeforeSync: true,
			confirmBeforeDeleteInAutoSync: true,
			syncMode: SyncMode.LOOSE,
			filterRules: {
				exclusionRules,
				inclusionRules: [],
			},
			skipLargeFiles: {
				maxSize: '30 MB',
			},
			realtimeSync: false,
			startupSyncDelaySeconds: 0,
			autoSyncIntervalSeconds: 300,
			language: undefined,
			ai: {
				providers: {},
				defaultModel: undefined,
				yolo: false,
			},
			configDirSyncMode: 'none',
		}

		const loadedSettings = (await this.loadData()) as Partial<NutstoreSettings>
		let shouldSaveSettings = false
		this.settings = { ...DEFAULT_SETTINGS, ...loadedSettings }
		if (this.settings.loginMode !== 'manual') {
			this.settings.loginMode = 'manual'
			shouldSaveSettings = true
			new Notice(i18n.t('settings.ssoStatus.switchedToManual'), 8000)
		}
		if (this.settings.oauthResponseText.length > 0) {
			this.settings.oauthResponseText = ''
			shouldSaveSettings = true
		}
		this.settings.ai ??= { providers: {}, defaultModel: undefined, yolo: false }
		if (Array.isArray(this.settings.ai.providers)) {
			this.settings.ai.providers = {}
		}
		let providersValid = true
		try {
			this.settings.ai.providers = sanitizeProviders(
				this.settings.ai.providers ?? {},
			)
		} catch (error) {
			logger.error(error)
			const detail =
				error instanceof Error ? error.message : 'Unknown validation error'
			new Notice(
				i18n.t('settings.ai.errors.invalidProvidersConfig', {
					reason: detail,
				}),
				10000,
			)
			providersValid = false
		}
		this.settings.ai.defaultModel = providersValid
			? sanitizeDefaultSelections(
					this.settings.ai.providers,
					this.settings.ai.defaultModel,
				)
			: undefined
		if (shouldSaveSettings) {
			await this.saveData(this.settings)
		}
	}

	async saveSettings() {
		await this.saveData(this.settings)
		await this.chatService.handleSettingsChanged()
	}

	toggleSyncUI(isSyncing: boolean) {
		this.isSyncing = isSyncing
		this.ribbonManager.update()
	}

	async getToken() {
		const token = `${this.settings.account}:${this.settings.credential}`
		return toBase64(token)
	}

	/**
	 * 检查账号配置是否完整
	 * @returns true 表示配置完整，false 表示未配置或配置不完整
	 */
	isAccountConfigured(): boolean {
		return (
			!!this.settings.account &&
			this.settings.account.trim() !== '' &&
			!!this.settings.credential &&
			this.settings.credential.trim() !== ''
		)
	}

	get remoteBaseDir() {
		let remoteDir = normalizePath(this.settings.remoteDir.trim())
		if (remoteDir === '' || remoteDir === '/') {
			remoteDir = this.app.vault.getName()
		}
		return stdRemotePath(remoteDir)
	}
}