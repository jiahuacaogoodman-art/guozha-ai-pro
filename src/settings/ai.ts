import { Notice, Setting } from 'obsidian'
import {
	getFirstModel,
	getModelById,
	getProviderById,
	listModels,
	listProviders,
	sanitizeDefaultSelections,
	sanitizeProviders,
} from '~/ai/config'
import {
	createMCPServerConfig,
	DEFAULT_MCP_PORT,
	normalizeMCPPort,
} from '~/ai/mcp'
import ProvidersManagerModal from '~/components/ProvidersManagerModal'
import i18n from '~/i18n'
import { runAsync } from '~/utils/async-helpers'
import logger from '~/utils/logger'
import BaseSettings from './settings.base'

function parseHeadersInput(value: string) {
	return Object.fromEntries(
		value
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.flatMap((line) => {
				const separator = line.indexOf(':')
				if (separator <= 0) {
					return []
				}
				const key = line.slice(0, separator).trim()
				const headerValue = line.slice(separator + 1).trim()
				return key && headerValue ? [[key, headerValue]] : []
			}),
	)
}

function stringifyHeaders(headers?: Record<string, string>) {
	return Object.entries(headers || {})
		.map(([key, value]) => `${key}: ${value}`)
		.join('\n')
}

function writeClipboard(text: string) {
	return navigator.clipboard.writeText(text)
}

export default class AISettings extends BaseSettings {
	private getLocalMCPUrl() {
		return (
			this.plugin.mcpServerService.url ||
			`http://localhost:${normalizeMCPPort(this.plugin.settings.ai.mcpServer?.port)}/mcp`
		)
	}

	private getBridgePath() {
		const adapter = this.plugin.app.vault.adapter as {
			getBasePath?: () => string
		}
		const pluginPath = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/mcp-stdio-bridge.cjs`
		const basePath = adapter.getBasePath?.()
		return basePath ? `${basePath}/${pluginPath}` : pluginPath
	}

	private getStdioConfig() {
		const nodeCommand =
			this.plugin.settings.ai.mcpServer?.nodeCommand?.trim() || 'node'
		const config: Record<string, unknown> = {
			mcpServers: {
				'guozha-ai-pro': {
					command: nodeCommand,
					args: [this.getBridgePath()],
					env: {
						GUOZHA_MCP_URL: this.getLocalMCPUrl(),
					},
				},
			},
		}
		if (this.plugin.settings.ai.mcpServer?.authMode === 'bearer') {
			(
				(
					config.mcpServers as Record<string, Record<string, unknown>>
				)['guozha-ai-pro'].env as Record<string, string>
			).GUOZHA_MCP_TOKEN = this.plugin.settings.ai.mcpServer?.token || ''
		}
		return JSON.stringify(config, null, 2)
	}

	private copySettingValue(value: string) {
		runAsync(async () => {
			await writeClipboard(value)
			new Notice(i18n.t('settings.ai.mcp.copied'))
		})
	}

	display() {
		this.containerEl.empty()

		new Setting(this.containerEl)
			.setName(i18n.t('settings.sections.ai'))
			.setHeading()

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.providers.name'))
			.setDesc(
				i18n.t('settings.ai.providers.summary', {
					count: listProviders(this.plugin.settings.ai.providers).length,
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.ai.providers.manage'))
						.onClick(() => {
							new ProvidersManagerModal(this.plugin, () => {
								runAsync(async () => {
									await this.persist(false)
									this.display()
								})
							}).open()
						}),
			)

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.defaultProvider.name'))
			.setDesc(i18n.t('settings.ai.defaultProvider.desc'))
			.addDropdown((dropdown) => {
				dropdown.addOption('', i18n.t('settings.ai.none'))
				for (const provider of listProviders(
					this.plugin.settings.ai.providers,
				)) {
					dropdown.addOption(
						provider.id,
						provider.name || i18n.t('settings.ai.unnamedProvider'),
					)
				}
				dropdown
					.setValue(this.plugin.settings.ai.defaultModel?.providerId || '')
						.onChange((value) => {
							runAsync(async () => {
								if (!value) {
									this.plugin.settings.ai.defaultModel = undefined
								} else {
									const provider = getProviderById(
										this.plugin.settings.ai.providers,
										value,
									)
									const currentModelId =
										this.plugin.settings.ai.defaultModel?.modelId
									const model =
										getModelById(provider, currentModelId) ||
										getFirstModel(provider)
									this.plugin.settings.ai.defaultModel = model
										? { providerId: value, modelId: model.id }
										: undefined
								}
								await this.persist()
								this.display()
							})
						})
			})

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.defaultModel.name'))
			.setDesc(i18n.t('settings.ai.defaultModel.desc'))
			.addDropdown((dropdown) => {
				const provider = getProviderById(
					this.plugin.settings.ai.providers,
					this.plugin.settings.ai.defaultModel?.providerId,
				)
				dropdown.addOption('', i18n.t('settings.ai.none'))
				for (const model of listModels(provider)) {
					dropdown.addOption(
						model.id,
						model.name || i18n.t('settings.ai.unnamedModel'),
					)
				}
				dropdown
					.setValue(this.plugin.settings.ai.defaultModel?.modelId || '')
					.setDisabled(!provider)
						.onChange((value) => {
							runAsync(async () => {
								const providerId =
									this.plugin.settings.ai.defaultModel?.providerId
								if (providerId && value) {
									this.plugin.settings.ai.defaultModel = {
										providerId,
										modelId: value,
									}
								} else {
									this.plugin.settings.ai.defaultModel = undefined
								}
								await this.persist()
							})
						})
			})

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.yolo.name'))
			.setDesc(i18n.t('settings.ai.yolo.desc'))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ai.yolo ?? false)
					.onChange((value) => {
						runAsync(async () => {
							this.plugin.settings.ai.yolo = value
							await this.persist()
						})
					}),
			)

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.mcp.name'))
			.setDesc(
				i18n.t('settings.ai.mcp.summary', {
					count: this.plugin.settings.ai.mcpServers?.length || 0,
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.ai.mcp.add'))
					.setCta()
					.onClick(() => {
						runAsync(async () => {
							this.plugin.settings.ai.mcpServers = [
								...(this.plugin.settings.ai.mcpServers || []),
								createMCPServerConfig({
									name: i18n.t('settings.ai.mcp.defaultName'),
									url: '',
								}),
							]
							await this.persist(false)
							this.display()
						})
					}),
			)

		for (const server of this.plugin.settings.ai.mcpServers || []) {
			new Setting(this.containerEl)
				.setName(server.name || server.id)
				.setDesc(server.url || i18n.t('settings.ai.mcp.noUrl'))
				.addText((text) =>
					text
						.setPlaceholder(i18n.t('settings.ai.mcp.namePlaceholder'))
						.setValue(server.name)
						.onChange((value) => {
							server.name = value
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder('https://example.com/mcp')
						.setValue(server.url)
						.onChange((value) => {
							server.url = value.trim()
						}),
				)
				.addTextArea((text) => {
					text
						.setPlaceholder(i18n.t('settings.ai.mcp.headersPlaceholder'))
						.setValue(stringifyHeaders(server.headers))
						.onChange((value) => {
							server.headers = parseHeadersInput(value)
						})
					text.inputEl.rows = 2
				})
				.addToggle((toggle) =>
					toggle.setValue(server.enabled).onChange((value) => {
						runAsync(async () => {
							server.enabled = value
							await this.persist()
							this.display()
						})
					}),
				)
				.addButton((button) =>
					button
						.setButtonText(i18n.t('settings.filters.save'))
						.onClick(() => {
							runAsync(async () => {
								this.plugin.settings.ai.mcpServers = (
									this.plugin.settings.ai.mcpServers || []
								).map((item) => createMCPServerConfig(item))
								await this.persist()
								this.display()
							})
						}),
				)
				.addButton((button) =>
					button
						.setButtonText(i18n.t('settings.filters.remove'))
						.onClick(() => {
							runAsync(async () => {
								this.plugin.settings.ai.mcpServers = (
									this.plugin.settings.ai.mcpServers || []
								).filter((item) => item.id !== server.id)
								await this.persist()
								this.display()
							})
						}),
				)
		}

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.mcp.local.name'))
			.setDesc(i18n.t('settings.ai.mcp.local.desc'))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ai.mcpServer?.enabled ?? false)
					.onChange((value) => {
						runAsync(async () => {
							this.plugin.settings.ai.mcpServer ??= {
								enabled: false,
								port: DEFAULT_MCP_PORT,
								authMode: 'open',
								nodeCommand: 'node',
							}
							this.plugin.settings.ai.mcpServer.enabled = value
							await this.persist()
							this.display()
						})
					}),
			)

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.mcp.local.port'))
			.setDesc(i18n.t('settings.ai.mcp.local.portDesc'))
			.addText((text) =>
				text
					.setPlaceholder('41733')
					.setValue(String(normalizeMCPPort(this.plugin.settings.ai.mcpServer?.port)))
					.onChange((value) => {
						this.plugin.settings.ai.mcpServer ??= {
							enabled: false,
							port: DEFAULT_MCP_PORT,
							authMode: 'open',
							nodeCommand: 'node',
						}
						const port = Number(value)
						if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
							this.plugin.settings.ai.mcpServer.port = port
						}
					}),
			)
			.addButton((button) =>
				button.setButtonText(i18n.t('settings.filters.save')).onClick(() => {
					runAsync(async () => {
						if (this.plugin.settings.ai.mcpServer) {
							this.plugin.settings.ai.mcpServer.port = normalizeMCPPort(
								this.plugin.settings.ai.mcpServer.port,
							)
						}
						await this.persist()
						this.display()
					})
				}),
			)

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.mcp.local.requireToken'))
			.setDesc(i18n.t('settings.ai.mcp.local.requireTokenDesc'))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ai.mcpServer?.authMode === 'bearer')
					.onChange((value) => {
						runAsync(async () => {
							this.plugin.settings.ai.mcpServer ??= {
								enabled: false,
								port: DEFAULT_MCP_PORT,
								authMode: 'open',
								nodeCommand: 'node',
							}
							this.plugin.settings.ai.mcpServer.authMode = value
								? 'bearer'
								: 'open'
							await this.persist()
							this.display()
						})
					}),
			)

		if (this.plugin.settings.ai.mcpServer?.authMode === 'bearer') {
			new Setting(this.containerEl)
				.setName(i18n.t('settings.ai.mcp.local.token'))
				.setDesc(i18n.t('settings.ai.mcp.local.tokenDesc'))
				.addText((text) => {
					text
						.setPlaceholder(i18n.t('settings.ai.mcp.local.tokenPlaceholder'))
						.setValue(this.plugin.settings.ai.mcpServer?.token || '')
						.onChange((value) => {
							this.plugin.settings.ai.mcpServer ??= {
								enabled: false,
								port: DEFAULT_MCP_PORT,
								authMode: 'open',
								nodeCommand: 'node',
							}
							this.plugin.settings.ai.mcpServer.token =
								value.trim() || undefined
						})
					text.inputEl.type = 'password'
				})
				.addButton((button) =>
					button
						.setIcon('copy')
						.setButtonText(i18n.t('settings.ai.mcp.copy'))
						.setTooltip(i18n.t('settings.ai.mcp.copy'))
						.onClick(() =>
							this.copySettingValue(
								this.plugin.settings.ai.mcpServer?.token || '',
							),
						),
				)
				.addButton((button) =>
					button.setButtonText(i18n.t('settings.filters.save')).onClick(() => {
						runAsync(async () => {
							await this.persist()
							this.display()
						})
					}),
				)
		}

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.mcp.local.nodeCommand'))
			.setDesc(i18n.t('settings.ai.mcp.local.nodeCommandDesc'))
			.addText((text) =>
				text
					.setPlaceholder('node')
					.setValue(this.plugin.settings.ai.mcpServer?.nodeCommand || 'node')
					.onChange((value) => {
						this.plugin.settings.ai.mcpServer ??= {
							enabled: false,
							port: DEFAULT_MCP_PORT,
							authMode: 'open',
							nodeCommand: 'node',
						}
						this.plugin.settings.ai.mcpServer.nodeCommand =
							value.trim() || 'node'
					}),
			)
			.addButton((button) =>
				button.setButtonText(i18n.t('settings.filters.save')).onClick(() => {
					runAsync(async () => {
						await this.persist()
						this.display()
					})
				}),
			)

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.mcp.local.httpUrl'))
			.setDesc(this.getLocalMCPUrl())
			.addButton((button) =>
				button
					.setIcon('copy')
					.setButtonText(i18n.t('settings.ai.mcp.copy'))
					.setTooltip(i18n.t('settings.ai.mcp.copy'))
					.onClick(() => this.copySettingValue(this.getLocalMCPUrl())),
			)

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.mcp.local.stdioConfig'))
			.setDesc(i18n.t('settings.ai.mcp.local.stdioConfigDesc'))
			.addButton((button) =>
				button
					.setIcon('copy')
					.setButtonText(i18n.t('settings.ai.mcp.copy'))
					.setTooltip(i18n.t('settings.ai.mcp.copy'))
					.onClick(() => this.copySettingValue(this.getStdioConfig())),
			)

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.mcp.local.bridgePath'))
			.setDesc(this.getBridgePath())
			.addButton((button) =>
				button
					.setIcon('copy')
					.setButtonText(i18n.t('settings.ai.mcp.copy'))
					.setTooltip(i18n.t('settings.ai.mcp.copy'))
					.onClick(() => this.copySettingValue(this.getBridgePath())),
			)

	}

	private async persist(showNotice: boolean = true) {
		try {
			this.plugin.settings.ai.providers = sanitizeProviders(
				this.plugin.settings.ai.providers,
			)
			this.plugin.settings.ai.defaultModel = sanitizeDefaultSelections(
				this.plugin.settings.ai.providers,
				this.plugin.settings.ai.defaultModel,
			)
			await this.plugin.saveSettings()
			if (showNotice) {
				new Notice(i18n.t('settings.ai.saved'))
			}
		} catch (error) {
			logger.error(error)
			new Notice(
				error instanceof Error
					? i18n.t('settings.ai.errors.saveFailedWithReason', {
							reason: error.message,
						})
					: i18n.t('settings.ai.errors.saveFailed'),
				10000,
			)
		}
	}
}