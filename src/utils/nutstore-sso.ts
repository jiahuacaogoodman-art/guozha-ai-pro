export const NUTSTORE_SSO_APP = 'obsidian' as const

interface CreateOAuthUrlArgs {
	app: string
}

interface DecryptSecretArgs {
	app: string
	s: string
}

const NUTSTORE_OAUTH_ENDPOINT = 'https://webdav-connect.jianguoyun.net.cn'
const NUTSTORE_SSO_PUBLIC_KEY =
	'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu/YP7YePFXMor91x5/IS+VoOPcrGzODMKj5eYUTTV7s1Nyxv5LQ4Gt5Ga6ghBxvwV5JwtpMiumCv69iAisCC1TUtA+36aw/mf9kRYEvH8Uxd/1LUj8v/4zbiZa0qFEFfSME9rTS/E4/wwlisoAN1VjtMY72OfbyYHEnFquiCo+Lm+Ir2M8gX9xSiqcXL3xk7chozvxUmXSkJHIGRb2xjcQYgQQzXjR1C+bysWL4SbssEavDK40xAsiRTtBU7JbiVz7rgLQvQbZpH/JVLVr5X9sCRgafuvH9HDRlkugwkRGECPZyBOELfPzZhS/ZLEN01F96OJmuDLsOrIdZVFDvbBQIDAQAB'
const NUTSTORE_SSO_SECRET_KEYS: Record<string, string> = {
	[NUTSTORE_SSO_APP]: 'HaXICKYButBEa8iuqfs8k6eQvmJwTAzD',
}

function base64ToBytes(value: string): Uint8Array {
	const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/')
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
	const binary = window.atob(padded)
	const bytes = new Uint8Array(new ArrayBuffer(binary.length))
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index)
	}
	return bytes
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength)
	new Uint8Array(buffer).set(bytes)
	return buffer
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return window.btoa(binary)
}

function createTicket(): string {
	if (typeof window.crypto.randomUUID === 'function') {
		return window.crypto.randomUUID()
	}

	const bytes = new Uint8Array(new ArrayBuffer(16))
	window.crypto.getRandomValues(bytes)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	const hex = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
		12,
		16,
	)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function importPublicKey(): Promise<CryptoKey> {
	const keyData = base64ToBytes(NUTSTORE_SSO_PUBLIC_KEY)
	return window.crypto.subtle.importKey(
		'spki',
		bytesToArrayBuffer(keyData),
		{
			name: 'RSA-OAEP',
			hash: 'SHA-256',
		},
		false,
		['encrypt'],
	)
}

async function importSecretKey(app: string): Promise<CryptoKey> {
	const secret = NUTSTORE_SSO_SECRET_KEYS[app]
	if (!secret) {
		throw new Error(`Unsupported Nutstore SSO app: ${app}`)
	}
	const keyData = new TextEncoder().encode(secret)
	return window.crypto.subtle.importKey(
		'raw',
		bytesToArrayBuffer(keyData),
		{
			name: 'AES-GCM',
		},
		false,
		['decrypt'],
	)
}

export async function createOAuthUrl({
	app,
}: CreateOAuthUrlArgs): Promise<string> {
	const key = await importPublicKey()
	const payload = JSON.stringify({
		timestamp: Math.floor(Date.now() / 1000),
		ticket: createTicket(),
		app,
	})
	const encrypted = await window.crypto.subtle.encrypt(
		{ name: 'RSA-OAEP' },
		key,
		new TextEncoder().encode(payload),
	)
	return `${NUTSTORE_OAUTH_ENDPOINT}/${app}/oauth?s=${encodeURIComponent(
		bytesToBase64(new Uint8Array(encrypted)),
	)}`
}

export async function decryptSecret({
	app,
	s,
}: DecryptSecretArgs): Promise<string> {
	const key = await importSecretKey(app)
	const encrypted = base64ToBytes(s)
	const plainText = await window.crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: encrypted.slice(0, 12),
		},
		key,
		encrypted.slice(12),
	)
	return new TextDecoder().decode(plainText)
}