import { createClient, WebDAVClient } from 'webdav'
import { NS_DAV_ENDPOINT } from '../consts'
import NutstorePlugin from '../index'
import { toError } from '../utils/async-helpers'
import { createRateLimitedWebDAVClient } from '../utils/rate-limited-client'

export class WebDAVService {
	constructor(private plugin: NutstorePlugin) {}

	async createWebDAVClient(): Promise<WebDAVClient> {
		const client = createClient(NS_DAV_ENDPOINT, {
			username: this.plugin.settings.account,
			password: this.plugin.settings.credential,
		})
		return createRateLimitedWebDAVClient(client)
	}

	async checkWebDAVConnection(): Promise<{ error?: Error; success: boolean }> {
		try {
			const client = await this.createWebDAVClient()
			return { success: await client.exists('/') }
		} catch (error) {
			return {
				error: toError(error),
				success: false,
			}
		}
	}
}