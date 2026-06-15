import { Notice, Setting } from 'obsidian'
import i18n from '~/i18n'
import { runAsync } from '~/utils/async-helpers'
import { is503Error } from '~/utils/is-503-error'
import BaseSettings from './settings.base'

export default class AccountSettings extends BaseSettings {
	display() {
		runAsync(async () => {
			this.containerEl.empty()
			new Setting(this.containerEl)
				.setName(i18n.t('settings.sections.account'))
				.setHeading()

			new Setting(this.containerEl)
				.setName(i18n.t('settings.loginMode.name'))
				.setDesc(i18n.t('settings.loginMode.desc'))
				.addDropdown((dropdown) =>
					dropdown
						.addOption('manual', i18n.t('settings.loginMode.manual'))
						.setValue('manual')
						.setDisabled(true),
				)

			new Setting(this.containerEl)
				.setName(i18n.t('settings.ssoStatus.unavailableTitle'))
				.setDesc(i18n.t('settings.ssoStatus.unavailableDesc'))

			this.displayManualLoginSettings()
		})
	}

	hide() {}

	private displayManualLoginSettings(): void {
		const helper = new Setting(this.containerEl)
		const anchor = helper.descEl.createEl('a', {
			href: 'https://help.jianguoyun.com/?p=2064',
			cls: 'no-underline',
			text: i18n.t('settings.help.name'),
		})
		anchor.target = '_blank'

		new Setting(this.containerEl)
			.setName(i18n.t('settings.account.name'))
			.setDesc(i18n.t('settings.account.desc'))
			.addText((text) =>
				text
					.setPlaceholder(i18n.t('settings.account.placeholder'))
					.setValue(this.plugin.settings.account)
					.onChange((value) => {
						runAsync(async () => {
							this.plugin.settings.account = value
							await this.plugin.saveSettings()
						})
					}),
			)

		new Setting(this.containerEl)
			.setName(i18n.t('settings.credential.name'))
			.setDesc(i18n.t('settings.credential.desc'))
			.addText((text) => {
				text
					.setPlaceholder(i18n.t('settings.credential.placeholder'))
					.setValue(this.plugin.settings.credential)
					.onChange((value) => {
						runAsync(async () => {
							this.plugin.settings.credential = value
							await this.plugin.saveSettings()
						})
					})
				text.inputEl.type = 'password'
			})

		this.displayCheckConnection()
	}

	private displayCheckConnection() {
		new Setting(this.containerEl)
			.setName(i18n.t('settings.checkConnection.name'))
			.setDesc(i18n.t('settings.checkConnection.desc'))
			.addButton((button) => {
				button
					.setButtonText(i18n.t('settings.checkConnection.name'))
					.onClick((e) => {
						runAsync(async () => {
							const buttonEl = e.target as HTMLElement
							buttonEl.classList.add('connection-button', 'loading')
							buttonEl.classList.remove('success', 'error')
							buttonEl.textContent = i18n.t('settings.checkConnection.name')
							try {
								const { success, error } =
									await this.plugin.webDAVService.checkWebDAVConnection()
								buttonEl.classList.remove('loading')
								if (success) {
									buttonEl.classList.add('success')
									buttonEl.textContent = i18n.t(
										'settings.checkConnection.successButton',
									)
									new Notice(i18n.t('settings.checkConnection.success'))
								} else if (error && is503Error(error)) {
									buttonEl.classList.add('error')
									buttonEl.textContent = i18n.t(
										'sync.error.requestsTooFrequent',
									)
									new Notice(i18n.t('sync.error.requestsTooFrequent'))
								} else {
									buttonEl.classList.add('error')
									buttonEl.textContent = i18n.t(
										'settings.checkConnection.failureButton',
									)
									new Notice(i18n.t('settings.checkConnection.failure'))
								}
							} catch {
								buttonEl.classList.remove('loading')
								buttonEl.classList.add('error')
								buttonEl.textContent = i18n.t(
									'settings.checkConnection.failureButton',
								)
								new Notice(i18n.t('settings.checkConnection.failure'))
							}
						})
					})
			})
	}
}