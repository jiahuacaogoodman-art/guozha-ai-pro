import { createOAuthUrl } from '@nutstore/sso-js'
import { Notice, Setting } from 'obsidian'
import LogoutConfirmModal from '~/components/LogoutConfirmModal'
import i18n from '~/i18n'
import {
	isNutstoreSsoUnavailableError,
	OAuthResponse,
} from '~/utils/decrypt-ticket-response'
import { is503Error } from '~/utils/is-503-error'
import logger from '~/utils/logger'
import BaseSettings from './settings.base'

export default class AccountSettings extends BaseSettings {
	private updateOAuthUrlTimer: number | null = null

	async display() {
		this.containerEl.empty()
		this.clearOAuthUrlTimer()
		new Setting(this.containerEl)
			.setName(i18n.t('settings.sections.account'))
			.setHeading()

		new Setting(this.containerEl)
			.setName(i18n.t('settings.loginMode.name'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('manual', i18n.t('settings.loginMode.manual'))
					.addOption('sso', i18n.t('settings.loginMode.sso'))
					.setValue(this.plugin.settings.loginMode)
					.onChange(async (value: 'manual' | 'sso') => {
						this.plugin.settings.loginMode = value
						await this.plugin.saveSettings()
						this.display()
					}),
			)

		if (this.settings.isSSO) {
			await this.displaySSOLoginSettings()
		} else {
			await this.displayManualLoginSettings()
		}
	}

	async hide() {
		this.clearOAuthUrlTimer()
	}

	private clearOAuthUrlTimer() {
		if (this.updateOAuthUrlTimer !== null) {
			window.clearInterval(this.updateOAuthUrlTimer)
			this.updateOAuthUrlTimer = null
		}
	}

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
					.onChange(async (value) => {
						this.plugin.settings.account = value
						await this.plugin.saveSettings()
					}),
			)

		new Setting(this.containerEl)
			.setName(i18n.t('settings.credential.name'))
			.setDesc(i18n.t('settings.credential.desc'))
			.addText((text) => {
				text
					.setPlaceholder(i18n.t('settings.credential.placeholder'))
					.setValue(this.plugin.settings.credential)
					.onChange(async (value) => {
						this.plugin.settings.credential = value
						await this.plugin.saveSettings()
					})
				text.inputEl.type = 'password'
			})

		this.displayCheckConnection()
	}

	private async displaySSOLoginSettings() {
		let isLoggedIn = this.plugin.settings.oauthResponseText.length > 0
		let oauth: OAuthResponse | undefined
		if (isLoggedIn) {
			try {
				oauth = await this.plugin.getDecryptedOAuthInfo()
			} catch (e) {
				logger.error(e)
				if (isNutstoreSsoUnavailableError(e)) {
					this.displaySsoUnavailable()
					return
				}
				isLoggedIn = false
			}
		}
		if (isLoggedIn && oauth?.username) {
			const el = new Setting(this.containerEl)
				.setName(i18n.t('settings.ssoStatus.loggedIn'))
				.setDesc(oauth.username)
				.addButton((button) => {
					button
						.setWarning()
						.setButtonText(i18n.t('settings.ssoStatus.logout'))
						.onClick(() => {
							new LogoutConfirmModal(this.app, async () => {
								this.plugin.settings.oauthResponseText = ''
								await this.plugin.saveSettings()
								new Notice(i18n.t('settings.ssoStatus.logoutSuccess'))
								this.display()
							}).open()
						})
				})
			el.descEl.classList.add('max-w-full', 'truncate')
			el.infoEl.classList.add('max-w-full')
			this.displayCheckConnection()
		} else {
			let oauthUrl = ''
			try {
				oauthUrl = await createOAuthUrl({
					app: 'obsidian',
				})
			} catch (error) {
				logger.error(error)
				if (isNutstoreSsoUnavailableError(error)) {
					this.displaySsoUnavailable()
					return
				}
				new Notice(i18n.t('settings.login.failure'))
			}
			new Setting(this.containerEl)
				.setName(i18n.t('settings.ssoStatus.notLoggedIn'))
				.addButton((button) => {
					button.setButtonText(i18n.t('settings.login.name'))
					button.setDisabled(oauthUrl.length === 0)
					const anchor = document.createElement('a')
					anchor.target = '_blank'
					button.buttonEl.parentElement?.appendChild(anchor)
					anchor.appendChild(button.buttonEl)
					if (oauthUrl.length > 0) {
						anchor.href = oauthUrl
					}
					this.updateOAuthUrlTimer = window.setInterval(async () => {
						const stillInDoc = document.contains(anchor)
						if (!stillInDoc) {
							this.clearOAuthUrlTimer()
							return
						}
						try {
							anchor.href = await createOAuthUrl({
								app: 'obsidian',
							})
						} catch (error) {
							logger.error(error)
							this.clearOAuthUrlTimer()
							if (isNutstoreSsoUnavailableError(error)) {
								this.display()
							}
						}
					}, 60 * 1000)
				})
		}
	}

	private displaySsoUnavailable() {
		new Setting(this.containerEl)
			.setName(i18n.t('settings.ssoStatus.unavailableTitle'))
			.setDesc(i18n.t('settings.ssoStatus.unavailableDesc'))
			.addButton((button) => {
				button
					.setButtonText(i18n.t('settings.ssoStatus.switchToManual'))
					.setCta()
					.onClick(async () => {
						this.plugin.settings.loginMode = 'manual'
						await this.plugin.saveSettings()
						new Notice(i18n.t('settings.ssoStatus.switchedToManual'))
						this.display()
					})
			})
	}

	private displayCheckConnection() {
		new Setting(this.containerEl)
			.setName(i18n.t('settings.checkConnection.name'))
			.setDesc(i18n.t('settings.checkConnection.desc'))
			.addButton((button) => {
				button
					.setButtonText(i18n.t('settings.checkConnection.name'))
					.onClick(async (e) => {
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
								buttonEl.textContent = i18n.t('sync.error.requestsTooFrequent')
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
	}
}
