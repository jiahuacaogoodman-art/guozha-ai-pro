import { App, Modal, Setting } from 'obsidian'
import type { AIFileOperation } from '~/ai/file-operation'
import type { PermissionRequest } from '~/ai/permission-guard'
import i18n from '~/i18n'

export type AIPermissionResult = 'approve' | 'auto-approve-operation' | 'deny'

function getOperationLabel(operation: AIFileOperation): string {
	switch (operation) {
		case 'copy':
			return i18n.t('aiPermission.operations.copy')
		case 'delete':
			return i18n.t('aiPermission.operations.delete')
		case 'edit':
			return i18n.t('aiPermission.operations.edit')
		case 'mkdir':
			return i18n.t('aiPermission.operations.mkdir')
		case 'move':
			return i18n.t('aiPermission.operations.move')
		case 'read':
			return i18n.t('aiPermission.operations.read')
		case 'write':
			return i18n.t('aiPermission.operations.write')
	}
}

export default class AIPermissionModal extends Modal {
	private result: AIPermissionResult = 'deny'
	private resolved = false
	private resolve!: (result: AIPermissionResult) => void

	constructor(
		app: App,
		private readonly request: PermissionRequest,
	) {
		super(app)
	}

	private renderSinglePathRequest() {
		if (!('path' in this.request.fs)) {
			return
		}
		const rowEl = this.contentEl.createEl('div', {
			cls: 'guozha-ai-permission-row',
		})

		rowEl.createEl('strong', {
			text: getOperationLabel(this.request.fs.kind),
		})
		rowEl.createEl('code', {
			cls: 'guozha-ai-permission-path',
			text: this.request.fs.path,
		})
	}

	private renderDualPathRequest() {
		if (!('src' in this.request.fs) || !('dest' in this.request.fs)) {
			return
		}
		const rowEl = this.contentEl.createEl('div', {
			cls: 'guozha-ai-permission-row',
		})

		rowEl.createEl('strong', {
			text: getOperationLabel(this.request.fs.kind),
		})

		rowEl.createEl('div', {
			cls: 'guozha-ai-permission-path-label guozha-ai-permission-path-label-first',
			text: i18n.t('aiPermission.source'),
		})

		rowEl.createEl('code', {
			cls: 'guozha-ai-permission-path',
			text: this.request.fs.src,
		})

		rowEl.createEl('div', {
			cls: 'guozha-ai-permission-path-label guozha-ai-permission-path-label-next',
			text: i18n.t('aiPermission.destination'),
		})

		rowEl.createEl('code', {
			cls: 'guozha-ai-permission-path',
			text: this.request.fs.dest,
		})
	}

	onOpen() {
		this.setTitle(i18n.t('aiPermission.title'))

		const { contentEl } = this
		contentEl.empty()

		contentEl.createEl('p', {
			text: i18n.t('aiPermission.message'),
		})
		contentEl.createEl('p', {
			text: i18n.t('aiPermission.sessionScopeHint'),
		})

		if (this.request.fs.kind === 'copy' || this.request.fs.kind === 'move') {
			this.renderDualPathRequest()
		} else {
			this.renderSinglePathRequest()
		}

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('aiPermission.deny'))
					.setWarning()
					.onClick(() => {
						this.result = 'deny'
						this.close()
					}),
			)
			.addButton((button) =>
				button.setButtonText(i18n.t('aiPermission.allowOnce')).onClick(() => {
					this.result = 'approve'
					this.close()
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('aiPermission.alwaysAllow'))
					.setCta()
					.onClick(() => {
						this.result = 'auto-approve-operation'
						this.close()
					}),
			)
	}

	onClose() {
		const { contentEl } = this
		contentEl.empty()
		if (!this.resolved) {
			this.resolved = true
			this.resolve(this.result)
		}
	}

	open(): Promise<AIPermissionResult> {
		return new Promise((resolve) => {
			this.resolve = resolve
			super.open()
		})
	}
}
