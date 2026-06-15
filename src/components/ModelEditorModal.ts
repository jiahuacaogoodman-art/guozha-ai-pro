import { Modal, Notice, Setting } from 'obsidian'
import { findPresetModelById } from '~/ai/config'
import { AIModelConfig } from '~/ai/types'
import i18n from '~/i18n'
import { getErrorMessage, runAsync } from '~/utils/async-helpers'
import logger from '~/utils/logger'
import { cloneDeep } from '~/utils/std'
import type NutstorePlugin from '..'

interface ModelEditorOptions {
	findPresetOnSave?: boolean
}

export default class ModelEditorModal extends Modal {
	private draft: AIModelConfig

	constructor(
		private plugin: NutstorePlugin,
		model: AIModelConfig,
		private onSave: (model: AIModelConfig) => Promise<boolean> | boolean,
		private isNew: boolean,
		private options: ModelEditorOptions = {},
	) {
		super(plugin.app)
		this.draft = cloneDeep(model)
	}

	onOpen() {
		const { contentEl } = this
		contentEl.empty()
		new Setting(contentEl)
			.setName(
				this.isNew
					? i18n.t('settings.ai.modals.model.createTitle')
					: i18n.t('settings.ai.modals.model.editTitle'),
			)
			.setHeading()

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.model.id'))
			.setDesc(i18n.t('settings.ai.model.idDesc'))
			.then((s) => s.settingEl.addClass('setting-required'))
			.addText((text) =>
				text.setValue(this.draft.id).onChange((value) => {
					this.draft.id = value
					this.draft.name = value
				}),
			)

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.filters.save'))
					.setCta()
					.onClick(() => {
						if (!this.draft.id.trim()) {
							new Notice(i18n.t('settings.ai.errors.emptyModelId'))
							return
						}
						runAsync(async () => {
							try {
								const toSave = cloneDeep(this.draft)
								toSave.id = toSave.id.trim()
								const presetModel = this.options.findPresetOnSave
									? findPresetModelById(toSave.id)
									: undefined
								const model = presetModel
									? {
											...presetModel,
											id: toSave.id,
										}
									: toSave
								const ok = await this.onSave(model)
								if (!ok) return
								this.close()
							} catch (error) {
								logger.error(error)
								new Notice(
									`${i18n.t('settings.ai.errors.saveFailed')}: ${getErrorMessage(error)}`,
								)
							}
						})
					}),
			)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.filters.cancel'))
					.onClick(() => this.close()),
			)
	}

	onClose() {
		this.contentEl.empty()
	}
}