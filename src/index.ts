import './polyfill'
import './webdav-patch'

import './assets/styles/global.css'

import { toBase64 } from 'js-base64'
import { normalizePath, Notice, ObsidianProtocolData, Plugin } from 'obsidian'
import { sanitizeDefaultSelections, sanitizeProviders } from './ai/config'
import {
	createMCPServerConfig,
	createMCPToken,
	DEFAULT_MCP_PORT,
	normalizeMCPPort,
} from './ai/mcp'
import { SyncRibbonManager } from './components/SyncRibbonManager'
import { emitCancelSync } from './events'
import { emitSsoReceive } from './events/sso-receive'
import i18n from './i18n'
import ChatService from './services/chat.service'
import CommandService from './services/command.service'
import EventsService from './services/events.service'
import I18nService from './services/i18n.service'
import InlineAIService from './services/inline-ai.service'
import LoggerService from './services/logger.service'
import MCPServerService from './services/mcp-server.service'
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
import { decryptOAuthResponse } from './utils/decrypt-ticket-response'
import { GlobMatchOptions } from './utils/glob-match'
import logger from './utils/logger'
import { stdRemotePath } from './utils/std-remote-path'
import ChatboxView, { CHATBOX_VIEW_TYPE } from './views/chatbox.view'

export default class NutstorePlugin extends Plugin {
	public isSyncing: boolean = false
	public settings!: NutstoreSettings
	private ssoCallbackHandlersRegistered = false

	public commandService = new CommandService(this)
	public eventsService = new EventsService(this)
	public i18nService = new I18nService(this)
	public inlineAIService = new InlineAIService(this)
	public loggerService = new LoggerService(this)
	public mcpServerService = new MCPServerService(this)
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
		this.inlineAIService.load()
		this.addSettingTab(new NutstoreSettingTab(this.app, this))
		this.registerView(CHATBOX_VIEW_TYPE, (leaf) => new ChatboxView(leaf, this))

		if (this.settings.loginMode === 'sso') {
			this.ensureSsoCallbackHandlers()
		}
		setPluginInstance(this)
		await this.chatService.handleSettingsChanged()
		await this.mcpServerService.refresh()

		await this.scheduledSyncService.start()
	}

	ensureSsoCallbackHandlers() {
		if (this.ssoCallbackHandlersRegistered) {
			return
		}

		const handleSsoCallback = async (data: ObsidianProtocolData) => {
			const token = data.s
			if (typeof token === 'string') {
				this.settings.loginMode = 'sso'
				this.settings.oauthResponseText = token
				await this.saveSettings()
				new Notice(i18n.t('settings.login.success'), 5000)
				emitSsoReceive({ token })
			}
		}
		this.registerObsidianProtocolHandler('guozha-ai-pro/sso', handleSsoCallback)
		// Nutstore's Obsidian OAuth app currently returns this legacy callback path.
		this.registerObsidianProtocolHandler('nutstore-sync/sso', handleSsoCallback)
		this.ssoCallbackHandlersRegistered = true
	}

	onunload() {
		setPluginInstance(null)
		emitCancelSync()
		this.scheduledSyncService.unload()
		this.progressService.unload()
		this.eventsService.unload()
		this.realtimeSyncService.unload()
		this.statusService.unload()
		this.mcpServerService.unload()
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
				inlineText: {
					enabled: true,
					temperature: 0.7,
					compactMaxTokens: 600,
					toolMaxTokens: 16000,
					toolMode: 'auto',
					keepInlineAfterFileWrite: false,
				},
				mcpServers: [],
				mcpServer: {
					enabled: false,
					port: DEFAULT_MCP_PORT,
					authMode: 'open',
					nodeCommand: 'node',
					token: createMCPToken(),
				},
			},
			configDirSyncMode: 'none',
		}

		const loadedSettings = (await this.loadData()) as Partial<NutstoreSettings>
		this.settings = { ...DEFAULT_SETTINGS, ...loadedSettings }
		this.settings.ai ??= { providers: {}, defaultModel: undefined, yolo: false }
		this.settings.ai.inlineText = {
			...DEFAULT_SETTINGS.ai.inlineText,
			...(this.settings.ai.inlineText || {}),
		}
		this.settings.ai.mcpServers = (this.settings.ai.mcpServers || []).map(
			(server) => createMCPServerConfig(server),
		)
		this.settings.ai.mcpServer = {
			enabled: this.settings.ai.mcpServer?.enabled ?? false,
			port: normalizeMCPPort(this.settings.ai.mcpServer?.port),
			authMode: this.settings.ai.mcpServer?.authMode || 'open',
			nodeCommand: this.settings.ai.mcpServer?.nodeCommand || 'node',
			token: this.settings.ai.mcpServer?.token || createMCPToken(),
		}
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
		this.settings.ai.inlineText.model = providersValid
			? sanitizeDefaultSelections(
					this.settings.ai.providers,
					this.settings.ai.inlineText.model,
				)
			: undefined
	}

	async saveSettings() {
		await this.saveData(this.settings)
		await this.chatService.handleSettingsChanged()
		await this.mcpServerService.refresh()
	}

	toggleSyncUI(isSyncing: boolean) {
		this.isSyncing = isSyncing
		this.ribbonManager.update()
	}

	async getDecryptedOAuthInfo() {
		return decryptOAuthResponse(this.settings.oauthResponseText)
	}

	async getToken() {
		let token
		if (this.settings.loginMode === 'sso') {
			const oauth = await this.getDecryptedOAuthInfo()
			token = `${oauth.username}:${oauth.access_token}`
		} else {
			token = `${this.settings.account}:${this.settings.credential}`
		}
		return toBase64(token)
	}

	/**
	 * 检查账号配置是否完整
	 * @returns true 表示配置完整，false 表示未配置或配置不完整
	 */
	isAccountConfigured(): boolean {
		if (this.settings.loginMode === 'sso') {
			// SSO 模式：检查是否有 OAuth 响应数据
			return (
				!!this.settings.oauthResponseText &&
				this.settings.oauthResponseText.trim() !== ''
			)
		} else {
			// 手动模式：检查账号和凭证是否都已填写
			return (
				!!this.settings.account &&
				this.settings.account.trim() !== '' &&
				!!this.settings.credential &&
				this.settings.credential.trim() !== ''
			)
		}
	}

	get remoteBaseDir() {
		let remoteDir = normalizePath(this.settings.remoteDir.trim())
		if (remoteDir === '' || remoteDir === '/') {
			remoteDir = this.app.vault.getName()
		}
		return stdRemotePath(remoteDir)
	}
}