import { App, Modal, Setting } from 'obsidian'
import i18n from '../i18n'
import { useSettings } from '../settings'
import { ConflictStrategy } from '~/sync/tasks/conflict-resolve.task'
import { runAsync } from '~/utils/async-helpers'

function getConflictStrategyI18nKey(strategy: ConflictStrategy) {
	switch (strategy) {
		case ConflictStrategy.DiffMatchPatch:
			return 'diffMatchPatch'
		case ConflictStrategy.Skip:
			return 'skip'
		case ConflictStrategy.DiffMatchPatchOrSkip:
			return 'diffMatchPatchOrSkip'
		case ConflictStrategy.LatestTimeStamp:
		default:
			return 'latestTimestamp'
	}
}

export default class SyncConfirmModal extends Modal {
	private onConfirm: () => void

	constructor(app: App, onConfirm: () => void) {
		super(app)
		this.onConfirm = onConfirm
	}

	onOpen() {
		runAsync(() => this.render())
	}

	private async render() {
		const { contentEl } = this
		const settings = await useSettings()

		new Setting(contentEl)
			.setName(i18n.t('sync.confirmModal.title'))
			.setHeading()
		const infoDiv = contentEl.createDiv({ cls: 'sync-info' })
		infoDiv.createEl('p', {
			text: i18n.t('sync.confirmModal.remoteDir', { dir: settings.remoteDir }),
		})
		infoDiv.createEl('p', {
			text: i18n.t('sync.confirmModal.strategy', {
				strategy: i18n.t(
					`settings.conflictStrategy.${getConflictStrategyI18nKey(settings.conflictStrategy)}`,
				),
			}),
		})
		contentEl.createEl('pre', { text: i18n.t('sync.confirmModal.message') })

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('sync.confirmModal.cancel'))
					.onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('sync.confirmModal.confirm'))
					.setCta()
					.onClick(() => {
						this.close()
						this.onConfirm()
					}),
			)
	}

	onClose() {
		const { contentEl } = this
		contentEl.empty()
	}
}