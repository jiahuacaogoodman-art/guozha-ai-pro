const UNAVAILABLE_MESSAGE =
	'This local build does not include Nutstore SSO. Use manual WebDAV login in plugin settings.'

export function createOAuthUrl(_options: { app: string }): Promise<string> {
	return Promise.resolve().then(() => {
		throw new Error(UNAVAILABLE_MESSAGE)
	})
}

export function decryptSecret(_options: {
	app: string
	s: string
}): Promise<string> {
	return Promise.resolve().then(() => {
		throw new Error(UNAVAILABLE_MESSAGE)
	})
}