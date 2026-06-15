import { decryptSecret, NUTSTORE_SSO_APP } from './nutstore-sso'

export interface OAuthResponse {
	username: string
	userid: string
	access_token: string
}

const UNAVAILABLE_MESSAGE = 'does not include Nutstore SSO'
function normalizeOAuthCipherText(cipherText: string): string {
	const trimmed = cipherText.trim()
	const base64Url = trimmed.replace(/-/g, '+').replace(/_/g, '/')
	const paddingLength = (4 - (base64Url.length % 4)) % 4
	return base64Url + '='.repeat(paddingLength)
}

export function isNutstoreSsoUnavailableError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.includes(UNAVAILABLE_MESSAGE) ||
			error.message.includes('Use manual WebDAV login'))
	)
}

export async function decryptOAuthResponse(cipherText: string) {
	const json = await decryptSecret({
		app: NUTSTORE_SSO_APP,
		s: normalizeOAuthCipherText(cipherText),
	})
	return JSON.parse(json) as OAuthResponse
}