const UNAVAILABLE_MESSAGE =
	'This local build does not include Nutstore SSO. Use manual WebDAV login in plugin settings.'

export async function createOAuthUrl(_options: { app: string }): Promise<string> {
	throw new Error(UNAVAILABLE_MESSAGE)
}

export async function decryptSecret(_options: {
	app: string
	s: string
}): Promise<string> {
	throw new Error(UNAVAILABLE_MESSAGE)
}