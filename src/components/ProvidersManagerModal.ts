import { Modal, Notice, Setting, setIcon } from 'obsidian'
import {
	createProviderConfig,
	createProviderFromPreset,
	listPresetProviders,
	listProviders,
} from '~/ai/config'
import { AIProviderConfig } from '~/ai/types'
import i18n from '~/i18n'
import { runAsync } from '~/utils/async-helpers'
import logger from '~/utils/logger'
import type NutstorePlugin from '..'
import ProviderEditorModal from './ProviderEditorModal'

const CUSTOM_OPTION = '__custom__'

export default class ProvidersManagerModal extends Modal {
	private selectedPresetId = CUSTOM_OPTION

	constructor(
		private plugin: NutstorePlugin,
		private onChanged: () => Promise<void> | void,
	) {
		super(plugin.app)
	}

	onOpen() {
		this.render()
	}

	private render() {
		const { contentEl } = this
		contentEl.empty()
		new Setting(contentEl)
			.setName(i18n.t('settings.ai.modals.providers.title'))
			.setHeading()

		const presets = listPresetProviders()

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.providers.name'))
			.setDesc(i18n.t('settings.ai.providers.desc'))
			.addDropdown((dropdown) => {
				dropdown.addOption(
					CUSTOM_OPTION,
					i18n.t('settings.ai.providers.presetCustom'),
				)
				for (const preset of presets) {
					dropdown.addOption(preset.id, preset.name)
				}
				dropdown.setValue(this.selectedPresetId)
				dropdown.onChange((value) => {
					this.selectedPresetId = value
				})
			})
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.ai.providers.add'))
					.setCta()
					.onClick(() => {
						const preset =
							this.selectedPresetId !== CUSTOM_OPTION
								? presets.find((p) => p.id === this.selectedPresetId)
								: undefined
						const draft = preset
							? createProviderFromPreset(preset, '')
							: createProviderConfig()
						new ProviderEditorModal(
							this.plugin,
							draft,
							async (provider) => {
								if (!provider.id) {
									new Notice(i18n.t('settings.ai.errors.emptyProviderId'))
									return false
								}
								if (this.plugin.settings.ai.providers[provider.id]) {
									new Notice(i18n.t('settings.ai.errors.duplicateProviderId'))
									return false
								}
								this.plugin.settings.ai.providers = {
									...this.plugin.settings.ai.providers,
									[provider.id]: provider,
								}
								await this.onChanged()
								this.render()
								return true
							},
							true,
						).open()
					}),
			)

		const providers = listProviders(this.plugin.settings.ai.providers)
		if (providers.length === 0) {
			contentEl.createDiv({
				cls: 'setting-item-description',
				text: i18n.t('settings.ai.providers.empty'),
			})
			return
		}

		for (const provider of providers) {
			new Setting(contentEl)
				.setName(provider.name || i18n.t('settings.ai.unnamedProvider'))
				.setDesc(provider.api || i18n.t('settings.ai.providers.openaiDefault'))
				.addButton((button) =>
					button
						.setButtonText(i18n.t('settings.ai.modals.provider.edit'))
						.onClick(() => {
							new ProviderEditorModal(
								this.plugin,
								provider,
								async (savedProvider) => {
									this.plugin.settings.ai.providers = {
										...this.plugin.settings.ai.providers,
										[savedProvider.id]: savedProvider,
									}
									await this.onChanged()
									this.render()
									return true
								},
								false,
							).open()
						}),
				)
				.addButton((button) => {
					let confirmDelete = false

					const resetButton = () => {
						confirmDelete = false
						button.buttonEl.empty()
						setIcon(button.buttonEl, 'trash')
						button.buttonEl.removeClass('mod-warning')
					}

					button.setIcon('trash').onClick(() => {
						if (!confirmDelete) {
							confirmDelete = true
							button.buttonEl.empty()
							button.buttonEl.createSpan({
								text: i18n.t('settings.ai.modals.confirmDeleteLabel'),
							})
							button.buttonEl.addClass('mod-warning')
							return
						}
						runAsync(() => this.deleteProvider(provider))
					})
					button.buttonEl.addEventListener('blur', resetButton)
				})
		}
	}

	private async deleteProvider(provider: AIProviderConfig) {
		try {
			const { [provider.id]: _deleted, ...providers } =
				this.plugin.settings.ai.providers
			this.plugin.settings.ai.providers = providers
			await this.onChanged()
			new Notice(i18n.t('settings.ai.modals.provider.deleted'))
			this.render()
		} catch (error) {
			logger.error(error)
			new Notice(i18n.t('settings.ai.errors.saveFailed'))
		}
	}

	onClose() {
		this.contentEl.empty()
	}
}