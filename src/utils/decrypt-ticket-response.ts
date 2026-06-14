import { decryptSecret } from '@nutstore/sso-js'

export interface OAuthResponse {
	username: string
	userid: string
	access_token: string
}

const UNAVAILABLE_MESSAGE = 'does not include Nutstore SSO'

export function isNutstoreSsoUnavailableError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.includes(UNAVAILABLE_MESSAGE) ||
			error.message.includes('Use manual WebDAV login'))
	)
}

export async function decryptOAuthResponse(cipherText: string) {
	const json = await decryptSecret({
		app: 'obsidian',
		s: cipherText,
	})
	return JSON.parse(json) as OAuthResponse
}
