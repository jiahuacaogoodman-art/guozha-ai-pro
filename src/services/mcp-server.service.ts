import { normalizePath, TFile } from 'obsidian'
import { createPermissionGuard } from '~/ai/permission-guard'
import { createAITools } from '~/ai/tools'
import { VAULT_MOUNT_POINT } from '~/ai/bash/runtime'
import { normalizeMCPPort } from '~/ai/mcp'
import type {
	AISession,
	AIToolDefinition,
	AIToolExecutionContext,
} from '~/ai/types'
import logger from '~/utils/logger'
import type NutstorePlugin from '..'

interface NodeRequest {
	method?: string
	url?: string
	headers: Record<string, string | string[] | undefined>
	on: (event: string, listener: (...args: unknown[]) => void) => NodeRequest
}

interface NodeResponse {
	writeHead: (status: number, headers?: Record<string, string>) => void
	write?: (body: string) => void
	end: (body?: string) => void
	on?: (event: string, listener: (...args: unknown[]) => void) => NodeResponse
}

interface NodeServer {
	listen: (port: number, host: string, callback?: () => void) => NodeServer
	close: (callback?: (error?: Error) => void) => void
	on: (event: string, listener: (...args: unknown[]) => void) => NodeServer
}

interface NodeHttpModule {
	createServer: (
		handler: (request: NodeRequest, response: NodeResponse) => void,
	) => NodeServer
}

type RuntimeWindow = Window & {
	require?: (moduleName: string) => unknown
}

interface JSONRPCRequest {
	jsonrpc?: string
	id?: string | number | null
	method?: string
	params?: Record<string, unknown>
}

interface VaultResourceInfo {
	uri: string
	name: string
	mimeType: string
}

interface MCPSession {
	id: string
	protocolVersion: string
	createdAt: number
	updatedAt: number
	subscriptions: Set<string>
}

interface SSEClient {
	sessionId: string
	response: NodeResponse
}

interface OAuthCode {
	code: string
	redirectUri: string
	codeChallenge?: string
	codeChallengeMethod?: string
	expiresAt: number
}

const LOCAL_TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
	read_file: {
		type: 'object',
		properties: {
			path: { type: 'string' },
		},
		required: ['path'],
		additionalProperties: false,
	},
	edit_file: {
		type: 'object',
		properties: {
			path: { type: 'string' },
			oldText: { type: 'string' },
			newText: { type: 'string' },
		},
		required: ['path', 'oldText', 'newText'],
		additionalProperties: false,
	},
	write_file: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description:
					'Vault-relative path or virtual /vault/... path to create or replace.',
			},
			content: {
				type: 'string',
				description: 'Full text content to write into the file.',
			},
		},
		required: ['path', 'content'],
		additionalProperties: false,
	},
	bash: {
		type: 'object',
		properties: {
			script: { type: 'string' },
			cwd: { type: 'string', default: '/vault' },
			stdin: { type: 'string' },
			rawScript: { type: 'boolean', default: false },
		},
		required: ['script'],
		additionalProperties: false,
	},
}

const LOCAL_TOOL_OUTPUT_SCHEMAS: Record<string, Record<string, unknown>> = {
	read_file: {
		type: 'object',
		properties: {
			path: { type: 'string' },
			content: { type: 'string' },
		},
		required: ['path', 'content'],
		additionalProperties: true,
	},
	edit_file: {
		type: 'object',
		properties: {
			path: { type: 'string' },
			replaced: { type: 'boolean' },
			matchCount: { type: 'number' },
		},
		required: ['path', 'replaced'],
		additionalProperties: true,
	},
	write_file: {
		type: 'object',
		properties: {
			path: { type: 'string' },
			written: { type: 'boolean' },
			created: { type: 'boolean' },
		},
		required: ['path', 'written', 'created'],
		additionalProperties: true,
	},
	bash: {
		type: 'object',
		properties: {
			content: { type: 'string' },
		},
		additionalProperties: true,
	},
}

const LOCAL_TOOL_ANNOTATIONS: Record<string, Record<string, unknown>> = {
	read_file: {
		readOnlyHint: true,
		openWorldHint: false,
	},
	edit_file: {
		readOnlyHint: false,
		destructiveHint: true,
		openWorldHint: false,
	},
	write_file: {
		readOnlyHint: false,
		destructiveHint: true,
		openWorldHint: false,
	},
	bash: {
		readOnlyHint: false,
		destructiveHint: true,
		openWorldHint: false,
	},
}

const LOCAL_TOOL_META: Record<string, Record<string, unknown>> = {
	read_file: {
		'openai/toolInvocation/invoking': 'Reading vault file',
		'openai/toolInvocation/invoked': 'Vault file read',
	},
	edit_file: {
		'openai/toolInvocation/invoking': 'Editing vault file',
		'openai/toolInvocation/invoked': 'Vault file edited',
	},
	write_file: {
		'openai/toolInvocation/invoking': 'Writing vault file',
		'openai/toolInvocation/invoked': 'Vault file written',
	},
	bash: {
		'openai/toolInvocation/invoking': 'Running vault command',
		'openai/toolInvocation/invoked': 'Vault command finished',
	},
}

const LOCAL_PROMPTS = [
	{
		name: 'summarize_vault_note',
		description: 'Summarize one Obsidian vault note.',
		arguments: [
			{
				name: 'path',
				description: 'Vault-relative note path, for example Notes/example.md.',
				required: true,
			},
		],
	},
	{
		name: 'search_vault',
		description:
			'Search the current Obsidian vault and explain the relevant notes.',
		arguments: [
			{
				name: 'query',
				description: 'Search words or a regular expression.',
				required: true,
			},
		],
	},
	{
		name: 'review_recent_notes',
		description: 'Review recently changed notes and produce a concise digest.',
		arguments: [],
	},
]

const RESOURCE_PAGE_SIZE = 200
const TOOL_PAGE_SIZE = 50
const OAUTH_CODE_TTL_MS = 5 * 60 * 1000
const BUNDLED_NODE_PATH =
	'/Users/caojiahua/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

const TEXT_MIME_TYPES: Record<string, string> = {
	canvas: 'application/json',
	css: 'text/css',
	csv: 'text/csv',
	html: 'text/html',
	js: 'text/javascript',
	json: 'application/json',
	jsonl: 'application/jsonl',
	md: 'text/markdown',
	mjs: 'text/javascript',
	ts: 'text/typescript',
	txt: 'text/plain',
	xml: 'application/xml',
	yaml: 'application/yaml',
	yml: 'application/yaml',
}

function getRuntimeRequire() {
	const candidate = (window as RuntimeWindow).require
	return typeof candidate === 'function' ? candidate : undefined
}

function getHttpModule(): NodeHttpModule | undefined {
	const runtimeRequire = getRuntimeRequire()
	if (!runtimeRequire) {
		return undefined
	}
	try {
		const http = runtimeRequire('http') as Partial<NodeHttpModule>
		return typeof http?.createServer === 'function'
			? (http as NodeHttpModule)
			: undefined
	} catch {
		return undefined
	}
}

function readBody(request: NodeRequest): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: string[] = []
		request
			.on('data', (chunk) => {
				chunks.push(
					chunk instanceof Uint8Array
						? new TextDecoder().decode(chunk)
						: String(chunk ?? ''),
				)
			})
			.on('end', () => resolve(chunks.join('')))
			.on('error', (error) =>
				reject(error instanceof Error ? error : new Error(String(error))),
			)
	})
}

function toJSONRPCResult(id: JSONRPCRequest['id'], result: unknown) {
	return {
		jsonrpc: '2.0',
		id: id ?? null,
		result,
	}
}

function toJSONRPCError(
	id: JSONRPCRequest['id'],
	code: number,
	message: string,
) {
	return {
		jsonrpc: '2.0',
		id: id ?? null,
		error: {
			code,
			message,
		},
	}
}

function encodeVaultResourceUri(path: string) {
	return `vault:///${path.split('/').map(encodeURIComponent).join('/')}`
}

function decodeVaultResourceUri(uri: string) {
	if (!uri.startsWith('vault:///')) {
		throw new Error(`Unsupported resource URI: ${uri}`)
	}
	return normalizePath(
		uri.slice('vault:///'.length).split('/').map(decodeURIComponent).join('/'),
	)
}

function getTextMimeType(file: TFile) {
	return TEXT_MIME_TYPES[file.extension.toLowerCase()] || 'text/plain'
}

function isTextResource(file: TFile) {
	return file.extension.toLowerCase() in TEXT_MIME_TYPES
}

function escapeHTML(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function createSessionId() {
	const bytes = new Uint8Array(18)
	if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
		crypto.getRandomValues(bytes)
	} else {
		for (let index = 0; index < bytes.length; index += 1) {
			bytes[index] = Math.floor(Math.random() * 256)
		}
	}
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
		'',
	)
}

function getHeader(request: NodeRequest, name: string) {
	const value = request.headers[name.toLowerCase()]
	return Array.isArray(value) ? value[0] : value
}

function accepts(request: NodeRequest, contentType: string) {
	return (getHeader(request, 'accept') || '').includes(contentType)
}

function isAllowedOrigin(request: NodeRequest) {
	const origin = getHeader(request, 'origin')
	if (!origin) {
		return true
	}
	try {
		const parsed = new URL(origin)
		return (
			(parsed.protocol === 'http:' &&
				(parsed.hostname === '127.0.0.1' ||
					parsed.hostname === 'localhost' ||
					parsed.hostname === '[::1]')) ||
			parsed.protocol === 'app:' ||
			parsed.protocol === 'obsidian:' ||
			parsed.protocol === 'capacitor:'
		)
	} catch {
		return false
	}
}

function toSSEMessage(payload: unknown) {
	return `event: message\ndata: ${JSON.stringify(payload)}\n\n`
}

function toJSONRPCNotification(
	method: string,
	params?: Record<string, unknown>,
) {
	return {
		jsonrpc: '2.0',
		method,
		...(params ? { params } : {}),
	}
}

function parseCursor(value: unknown) {
	if (typeof value !== 'string') {
		return 0
	}
	const cursor = Number(value)
	return Number.isFinite(cursor) && cursor > 0 ? cursor : 0
}

function paginate<T>(items: T[], cursor: unknown, pageSize: number) {
	const offset = parseCursor(cursor)
	const page = items.slice(offset, offset + pageSize)
	const nextOffset = offset + page.length
	return {
		page,
		nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
	}
}

function parseRequestURL(request: NodeRequest, baseUrl: string) {
	return new URL(request.url || '/', baseUrl || 'http://localhost')
}

function isSafeOAuthRedirectUri(value: string) {
	try {
		const url = new URL(value)
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			return (
				url.hostname === 'localhost' ||
				url.hostname === '127.0.0.1' ||
				url.hostname === '[::1]'
			)
		}
		return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
	} catch {
		return false
	}
}

function appendQuery(url: string, params: Record<string, string>) {
	const target = new URL(url)
	for (const [key, value] of Object.entries(params)) {
		target.searchParams.set(key, value)
	}
	return target.toString()
}

function parseURLEncodedBody(value: string) {
	return Object.fromEntries(new URLSearchParams(value).entries())
}

function toBase64URL(bytes: Uint8Array) {
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '')
}

async function verifyPKCE(code: OAuthCode, verifier: string) {
	if (!code.codeChallenge) {
		return true
	}
	if (!verifier) {
		return false
	}
	if (code.codeChallengeMethod === 'S256') {
		const digest = await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(verifier),
		)
		return toBase64URL(new Uint8Array(digest)) === code.codeChallenge
	}
	return verifier === code.codeChallenge
}

export default class MCPServerService {
	private server?: NodeServer
	private runningPort?: number
	private sessions = new Map<string, MCPSession>()
	private sseClients = new Set<SSEClient>()
	private oauthCodes = new Map<string, OAuthCode>()
	private vaultEventsRegistered = false

	constructor(private plugin: NutstorePlugin) {}

	get url() {
		return this.runningPort ? `${this.baseUrl}/mcp` : ''
	}

	private get baseUrl() {
		return this.runningPort ? `http://localhost:${this.runningPort}` : ''
	}

	async refresh() {
		const config = this.plugin.settings.ai.mcpServer
		if (!config?.enabled) {
			await this.stop()
			return
		}
		const targetPort = normalizeMCPPort(config.port)
		if (this.server && this.runningPort === targetPort) {
			return
		}
		await this.stop()
		try {
			await this.start(targetPort)
		} catch (error) {
			logger.error('Failed to start MCP local server:', error)
			await this.stop()
		}
	}

	unload() {
		void this.stop()
	}

	private async start(port: number) {
		const http = getHttpModule()
		if (!http) {
			logger.warn('MCP local server is only available on desktop Obsidian.')
			return
		}
		this.registerVaultEvents()
		const server = http.createServer((request, response) => {
			void this.handleRequest(request, response)
		})
		await new Promise<void>((resolve, reject) => {
			server.on('error', (error) =>
				reject(error instanceof Error ? error : new Error(String(error))),
			)
			server.listen(port, '127.0.0.1', () => resolve())
		})
		this.server = server
		this.runningPort = port
		logger.info(`MCP local server listening on ${this.url}`)
	}

	private async stop() {
		for (const client of this.sseClients) {
			client.response.end()
		}
		this.sseClients.clear()
		this.sessions.clear()
		this.oauthCodes.clear()
		if (!this.server) {
			this.runningPort = undefined
			return
		}
		const server = this.server
		this.server = undefined
		this.runningPort = undefined
		await new Promise<void>((resolve) => {
			server.close(() => resolve())
		})
	}

	private registerVaultEvents() {
		if (this.vaultEventsRegistered) {
			return
		}
		this.vaultEventsRegistered = true
		this.plugin.registerEvent(
			this.plugin.app.vault.on('create', (file) => {
				if (file instanceof TFile && isTextResource(file)) {
					this.broadcastNotification('notifications/resources/list_changed')
				}
			}),
		)
		this.plugin.registerEvent(
			this.plugin.app.vault.on('delete', (file) => {
				if (file instanceof TFile && isTextResource(file)) {
					this.broadcastNotification('notifications/resources/list_changed')
				}
			}),
		)
		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', (file) => {
				if (file instanceof TFile && isTextResource(file)) {
					this.broadcastNotification('notifications/resources/list_changed')
					this.notifyResourceUpdated(encodeVaultResourceUri(file.path))
				}
			}),
		)
		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', (file) => {
				if (file instanceof TFile && isTextResource(file)) {
					this.notifyResourceUpdated(encodeVaultResourceUri(file.path))
				}
			}),
		)
	}

	private headers(extra?: Record<string, string>, sessionId?: string) {
		return {
			'access-control-allow-origin': '*',
			'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
			'access-control-allow-headers':
				'content-type, authorization, x-guozha-mcp-token, mcp-protocol-version, mcp-session-id',
			...(sessionId ? { 'mcp-session-id': sessionId } : {}),
			...extra,
		}
	}

	private unauthorizedHeaders() {
		return this.headers({
			'content-type': 'application/json; charset=utf-8',
			'www-authenticate': `Bearer realm="Guozha AI Pro MCP", error="invalid_token", resource_metadata="${this.baseUrl}/.well-known/oauth-protected-resource"`,
		})
	}

	private isAuthorized(request: NodeRequest) {
		if (this.plugin.settings.ai.mcpServer?.authMode !== 'bearer') {
			return true
		}
		const token = this.plugin.settings.ai.mcpServer?.token
		if (!token) {
			return false
		}
		const authorization = getHeader(request, 'authorization')
		const headerToken = request.headers['x-guozha-mcp-token']
		return (
			authorization === `Bearer ${token}` ||
			headerToken === token ||
			(Array.isArray(headerToken) && headerToken.includes(token))
		)
	}

	private async handleRequest(request: NodeRequest, response: NodeResponse) {
		if (!isAllowedOrigin(request)) {
			response.writeHead(
				403,
				this.headers({ 'content-type': 'application/json; charset=utf-8' }),
			)
			response.end(
				JSON.stringify(toJSONRPCError(null, -32003, 'Forbidden Origin')),
			)
			return
		}
		if (request.method === 'OPTIONS') {
			response.writeHead(204, this.headers())
			response.end()
			return
		}
		const path = request.url?.split('?')[0] || '/'
		if (request.method === 'GET' && path === '/mcp') {
			if (accepts(request, 'text/event-stream')) {
				this.handleSSEStream(request, response)
			} else {
				this.handleStatusPage(response)
			}
			return
		}
		if (request.method === 'GET' && path === '/health') {
			this.handleHealth(response)
			return
		}
		if (
			request.method === 'GET' &&
			(path === '/.well-known/oauth-protected-resource' ||
				path === '/.well-known/oauth-protected-resource/mcp')
		) {
			this.handleOAuthProtectedResource(response)
			return
		}
		if (
			request.method === 'GET' &&
			(path === '/.well-known/oauth-authorization-server' ||
				path === '/.well-known/openid-configuration')
		) {
			this.handleOAuthAuthorizationServer(response)
			return
		}
		if (request.method === 'GET' && path === '/oauth/authorize') {
			this.handleOAuthAuthorize(request, response)
			return
		}
		if (request.method === 'POST' && path === '/oauth/token') {
			await this.handleOAuthToken(request, response)
			return
		}
		if (request.method === 'POST' && path === '/oauth/register') {
			await this.handleOAuthRegister(request, response)
			return
		}
		if (request.method === 'DELETE' && path === '/mcp') {
			this.handleDeleteSession(request, response)
			return
		}
		if (request.method !== 'POST' || path !== '/mcp') {
			response.writeHead(404, this.headers({ 'content-type': 'text/plain' }))
			response.end('Not found')
			return
		}
		if (!this.isAuthorized(request)) {
			response.writeHead(401, this.unauthorizedHeaders())
			response.end(
				JSON.stringify(
					toJSONRPCError(null, -32001, 'Unauthorized MCP request'),
				),
			)
			return
		}

		let payload: JSONRPCRequest | JSONRPCRequest[]
		try {
			payload = JSON.parse(await readBody(request)) as JSONRPCRequest
		} catch {
			response.writeHead(
				400,
				this.headers({ 'content-type': 'application/json' }),
			)
			response.end(JSON.stringify(toJSONRPCError(null, -32700, 'Parse error')))
			return
		}

		const requests = Array.isArray(payload) ? payload : [payload]
		const session = this.resolveRequestSession(request, requests, response)
		if (!session) {
			return
		}
		const rawResults = await Promise.all(
			requests.map((item) => this.handleJSONRPC(item, session)),
		)
		const results = rawResults.filter((item) => item !== undefined)
		if (results.length === 0) {
			response.writeHead(202, this.headers(undefined, session.id))
			response.end()
			return
		}
		const body = Array.isArray(payload) ? results : results[0]
		if (accepts(request, 'text/event-stream')) {
			response.writeHead(
				200,
				this.headers(
					{
						'content-type': 'text/event-stream; charset=utf-8',
						'cache-control': 'no-cache, no-transform',
						connection: 'keep-alive',
					},
					session.id,
				),
			)
			response.write?.(toSSEMessage(body))
			response.end()
			return
		}
		response.writeHead(
			200,
			this.headers(
				{ 'content-type': 'application/json; charset=utf-8' },
				session.id,
			),
		)
		response.end(JSON.stringify(body))
	}

	private resolveRequestSession(
		request: NodeRequest,
		requests: JSONRPCRequest[],
		response: NodeResponse,
	) {
		const sessionId = getHeader(request, 'mcp-session-id')
		const initializeRequest = requests.find(
			(item) => item.method === 'initialize',
		)
		if (initializeRequest) {
			const params = initializeRequest.params || {}
			const requestedProtocol =
				typeof params.protocolVersion === 'string'
					? params.protocolVersion
					: DEFAULT_PROTOCOL_VERSION
			const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(
				requestedProtocol,
			)
				? requestedProtocol
				: DEFAULT_PROTOCOL_VERSION
			const session = this.createSession(protocolVersion)
			return session
		}
		if (!sessionId) {
			response.writeHead(
				400,
				this.headers({ 'content-type': 'application/json; charset=utf-8' }),
			)
			response.end(
				JSON.stringify(toJSONRPCError(null, -32000, 'Missing MCP-Session-Id')),
			)
			return undefined
		}
		const session = this.sessions.get(sessionId)
		if (!session) {
			response.writeHead(
				404,
				this.headers({ 'content-type': 'application/json; charset=utf-8' }),
			)
			response.end(
				JSON.stringify(toJSONRPCError(null, -32000, 'Unknown MCP session')),
			)
			return undefined
		}
		const protocolHeader = getHeader(request, 'mcp-protocol-version')
		if (
			protocolHeader &&
			!SUPPORTED_PROTOCOL_VERSIONS.includes(protocolHeader)
		) {
			response.writeHead(
				400,
				this.headers({ 'content-type': 'application/json; charset=utf-8' }),
			)
			response.end(
				JSON.stringify(
					toJSONRPCError(
						null,
						-32000,
						`Unsupported MCP protocol version: ${protocolHeader}`,
					),
				),
			)
			return undefined
		}
		session.updatedAt = Date.now()
		return session
	}

	private createSession(protocolVersion: string) {
		const now = Date.now()
		const session: MCPSession = {
			id: createSessionId(),
			protocolVersion,
			createdAt: now,
			updatedAt: now,
			subscriptions: new Set(),
		}
		this.sessions.set(session.id, session)
		return session
	}

	private handleDeleteSession(request: NodeRequest, response: NodeResponse) {
		if (!this.isAuthorized(request)) {
			response.writeHead(401, this.unauthorizedHeaders())
			response.end(
				JSON.stringify(
					toJSONRPCError(null, -32001, 'Unauthorized MCP request'),
				),
			)
			return
		}
		const sessionId = getHeader(request, 'mcp-session-id')
		if (!sessionId || !this.sessions.has(sessionId)) {
			response.writeHead(
				404,
				this.headers({ 'content-type': 'application/json; charset=utf-8' }),
			)
			response.end(
				JSON.stringify(toJSONRPCError(null, -32000, 'Unknown MCP session')),
			)
			return
		}
		this.sessions.delete(sessionId)
		for (const client of Array.from(this.sseClients)) {
			if (client.sessionId === sessionId) {
				client.response.end()
				this.sseClients.delete(client)
			}
		}
		response.writeHead(204, this.headers(undefined, sessionId))
		response.end()
	}

	private handleSSEStream(request: NodeRequest, response: NodeResponse) {
		if (!this.isAuthorized(request)) {
			response.writeHead(401, this.unauthorizedHeaders())
			response.end(
				JSON.stringify(
					toJSONRPCError(null, -32001, 'Unauthorized MCP request'),
				),
			)
			return
		}
		const sessionId = getHeader(request, 'mcp-session-id')
		if (!sessionId || !this.sessions.has(sessionId)) {
			response.writeHead(
				404,
				this.headers({ 'content-type': 'application/json; charset=utf-8' }),
			)
			response.end(
				JSON.stringify(toJSONRPCError(null, -32000, 'Unknown MCP session')),
			)
			return
		}
		response.writeHead(
			200,
			this.headers(
				{
					'content-type': 'text/event-stream; charset=utf-8',
					'cache-control': 'no-cache, no-transform',
					connection: 'keep-alive',
				},
				sessionId,
			),
		)
		const client: SSEClient = { sessionId, response }
		this.sseClients.add(client)
		response.write?.(': connected\n\n')
		response.on?.('close', () => {
			this.sseClients.delete(client)
		})
	}

	private handleHealth(response: NodeResponse) {
		response.writeHead(
			200,
			this.headers({ 'content-type': 'application/json; charset=utf-8' }),
		)
		response.end(
			JSON.stringify({
				ok: true,
				name: 'Guozha AI Pro MCP Server',
				url: this.url,
				protocolVersion: '2025-06-18',
				capabilities: {
					tools: true,
					resources: true,
					resourceSubscriptions: true,
					prompts: true,
					streamableHttp: true,
				},
			}),
		)
	}

	private handleOAuthProtectedResource(response: NodeResponse) {
		response.writeHead(
			200,
			this.headers({
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store',
			}),
		)
		response.end(
			JSON.stringify({
				resource: this.url,
				resource_name: 'Guozha AI Pro MCP Server',
				authorization_servers: [this.baseUrl],
				scopes_supported: ['guozha:mcp'],
				bearer_methods_supported: ['header'],
				resource_documentation: `${this.baseUrl}/mcp`,
			}),
		)
	}

	private handleOAuthAuthorizationServer(response: NodeResponse) {
		response.writeHead(
			200,
			this.headers({
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store',
			}),
		)
		response.end(
			JSON.stringify({
				issuer: this.baseUrl,
				authorization_endpoint: `${this.baseUrl}/oauth/authorize`,
				token_endpoint: `${this.baseUrl}/oauth/token`,
				registration_endpoint: `${this.baseUrl}/oauth/register`,
				response_types_supported: ['code'],
				grant_types_supported: ['authorization_code'],
				token_endpoint_auth_methods_supported: ['none'],
				code_challenge_methods_supported: ['S256'],
				scopes_supported: ['guozha:mcp'],
			}),
		)
	}

	private async handleOAuthRegister(
		request: NodeRequest,
		response: NodeResponse,
	) {
		const body = await readBody(request).catch(() => '{}')
		let requested: Record<string, unknown> = {}
		try {
			requested = JSON.parse(body || '{}') as Record<string, unknown>
		} catch {
			requested = {}
		}
		response.writeHead(
			201,
			this.headers({
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store',
			}),
		)
		response.end(
			JSON.stringify({
				client_id: createSessionId(),
				client_id_issued_at: Math.floor(Date.now() / 1000),
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code'],
				response_types: ['code'],
				redirect_uris: Array.isArray(requested.redirect_uris)
					? requested.redirect_uris
					: [],
			}),
		)
	}

	private handleOAuthAuthorize(request: NodeRequest, response: NodeResponse) {
		const url = parseRequestURL(request, this.baseUrl)
		const redirectUri = url.searchParams.get('redirect_uri') || ''
		const state = url.searchParams.get('state') || ''
		const responseType = url.searchParams.get('response_type') || ''
		if (responseType !== 'code' || !isSafeOAuthRedirectUri(redirectUri)) {
			response.writeHead(
				400,
				this.headers({ 'content-type': 'text/html; charset=utf-8' }),
			)
			response.end(
				'<h1>Invalid OAuth request</h1><p>Only authorization_code flow with a localhost or app-scheme redirect URI is allowed.</p>',
			)
			return
		}
		const code = createSessionId()
		this.oauthCodes.set(code, {
			code,
			redirectUri,
			codeChallenge: url.searchParams.get('code_challenge') || undefined,
			codeChallengeMethod:
				url.searchParams.get('code_challenge_method') || undefined,
			expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
		})
		response.writeHead(302, {
			location: appendQuery(redirectUri, {
				code,
				...(state ? { state } : {}),
			}),
			'cache-control': 'no-store',
		})
		response.end()
	}

	private async handleOAuthToken(request: NodeRequest, response: NodeResponse) {
		const body = parseURLEncodedBody(await readBody(request))
		const codeValue = body.code || ''
		const code = this.oauthCodes.get(codeValue)
		const redirectUri = body.redirect_uri || ''
		if (
			body.grant_type !== 'authorization_code' ||
			!code ||
			code.expiresAt < Date.now() ||
			code.redirectUri !== redirectUri ||
			!(await verifyPKCE(code, body.code_verifier || ''))
		) {
			response.writeHead(
				400,
				this.headers({
					'content-type': 'application/json; charset=utf-8',
					'cache-control': 'no-store',
				}),
			)
			response.end(
				JSON.stringify({
					error: 'invalid_grant',
					error_description: 'Invalid or expired authorization code.',
				}),
			)
			return
		}
		this.oauthCodes.delete(codeValue)
		response.writeHead(
			200,
			this.headers({
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store',
			}),
		)
		response.end(
			JSON.stringify({
				access_token:
					this.plugin.settings.ai.mcpServer?.token || createSessionId(),
				token_type: 'Bearer',
				scope: 'guozha:mcp',
				expires_in: 31536000,
			}),
		)
	}

	private handleStatusPage(response: NodeResponse) {
		const toolNames = this.listTools()
			.map((tool) => `<li><code>${escapeHTML(tool.name)}</code></li>`)
			.join('')
		const resourceCount = this.listResourceFiles().length
		const activeSessions = this.sessions.size
		response.writeHead(
			200,
			this.headers({ 'content-type': 'text/html; charset=utf-8' }),
		)
		response.end(`<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width,initial-scale=1">
	<title>Guozha AI Pro MCP Server</title>
	<style>
		body{margin:0;padding:32px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#111;color:#eee}
		main{max-width:760px;margin:auto}
		code,pre{background:#222;border:1px solid #333;border-radius:6px}
		code{padding:2px 5px}
		pre{padding:14px;overflow:auto}
		.muted{color:#aaa}
	</style>
</head>
<body>
<main>
	<h1>Guozha AI Pro MCP Server</h1>
	<p class="muted">Status: running on <code>${escapeHTML(this.url)}</code></p>
	<p>This endpoint is for MCP JSON-RPC over HTTP. Use <code>POST /mcp</code> from an MCP client.</p>
	<h2>Client config</h2>
	<pre>{
  "url": "${escapeHTML(this.url)}",
  "headers": {
    "Authorization": "Bearer &lt;token from Guozha settings&gt;"
  }
}</pre>
	<h2>Stdio bridge config</h2>
	<pre>{
  "mcpServers": {
    "guozha-ai-pro": {
      "command": "${escapeHTML(BUNDLED_NODE_PATH)}",
      "args": [
        "${escapeHTML(this.getBridgePath())}"
      ],
      "env": {
        "GUOZHA_MCP_URL": "${escapeHTML(this.url)}"
      }
    }
  }
}</pre>
	<h2>Capabilities</h2>
	<ul>
		<li>Tools: ${this.listTools().length}</li>
		<li>Vault text resources: ${resourceCount}</li>
		<li>Prompts: ${LOCAL_PROMPTS.length}</li>
		<li>Active sessions: ${activeSessions}</li>
		<li>Health check: <code>/health</code></li>
		<li>OAuth protected resource metadata: <code>/.well-known/oauth-protected-resource</code></li>
		<li>OAuth authorization server metadata: <code>/.well-known/oauth-authorization-server</code></li>
		<li>Streamable HTTP: <code>POST /mcp</code> with <code>Accept: text/event-stream</code></li>
		<li>Session close: <code>DELETE /mcp</code> with <code>MCP-Session-Id</code></li>
	</ul>
	<h2>Tools</h2>
	<ul>${toolNames}</ul>
</main>
</body>
</html>`)
	}

	private getBridgePath() {
		const adapter = this.plugin.app.vault.adapter as {
			getBasePath?: () => string
		}
		const pluginPath = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/mcp-stdio-bridge.cjs`
		const basePath = adapter.getBasePath?.()
		return basePath ? `${basePath}/${pluginPath}` : pluginPath
	}

	private async handleJSONRPC(request: JSONRPCRequest, session: MCPSession) {
		try {
			switch (request.method) {
				case 'initialize':
					return toJSONRPCResult(request.id, {
						protocolVersion: session.protocolVersion,
						capabilities: {
							tools: {
								listChanged: false,
							},
							resources: {
								listChanged: true,
								subscribe: true,
							},
							prompts: {
								listChanged: false,
							},
						},
						serverInfo: {
							name: 'Guozha AI Pro',
							version: process.env.PLUGIN_VERSION || '0.0.0',
						},
					})
				case 'ping':
					return toJSONRPCResult(request.id, {})
				case 'notifications/initialized':
					return request.id === undefined
						? undefined
						: toJSONRPCResult(request.id, {})
				case 'tools/list':
					return toJSONRPCResult(request.id, this.listMCPTools(request.params))
				case 'tools/call':
					return toJSONRPCResult(
						request.id,
						await this.callTool(request.params),
					)
				case 'resources/list':
					return toJSONRPCResult(request.id, this.listResources(request.params))
				case 'resources/read':
					return toJSONRPCResult(
						request.id,
						await this.readResource(request.params),
					)
				case 'resources/subscribe':
					return toJSONRPCResult(
						request.id,
						this.subscribeResource(session, request.params),
					)
				case 'resources/unsubscribe':
					return toJSONRPCResult(
						request.id,
						this.unsubscribeResource(session, request.params),
					)
				case 'resources/templates/list':
					return toJSONRPCResult(request.id, {
						resourceTemplates: [
							{
								uriTemplate: 'vault:///{path}',
								name: 'Vault text file',
								description:
									'Read a text file from the current Obsidian vault by vault-relative path.',
								mimeType: 'text/plain',
							},
						],
					})
				case 'prompts/list':
					return toJSONRPCResult(request.id, this.listPrompts(request.params))
				case 'prompts/get':
					return toJSONRPCResult(request.id, this.getPrompt(request.params))
				case 'logging/setLevel':
					return toJSONRPCResult(request.id, {})
				default:
					return toJSONRPCError(
						request.id,
						-32601,
						`Unknown MCP method: ${request.method || '(missing)'}`,
					)
			}
		} catch (error) {
			return toJSONRPCError(
				request.id,
				-32000,
				error instanceof Error ? error.message : String(error),
			)
		}
	}

	private listTools() {
		return createAITools(this.plugin.app, {
			allowSpawn: false,
			permissionGuard: createPermissionGuard(
				this.plugin.app,
				() => this.plugin.settings,
			),
		})
	}

	private listMCPTools(params: Record<string, unknown> | undefined) {
		const tools = this.listTools().map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: LOCAL_TOOL_SCHEMAS[tool.name] || {
				type: 'object',
				additionalProperties: true,
			},
			outputSchema: LOCAL_TOOL_OUTPUT_SCHEMAS[tool.name] || {
				type: 'object',
				additionalProperties: true,
			},
			annotations: LOCAL_TOOL_ANNOTATIONS[tool.name] || {
				openWorldHint: false,
			},
			_meta: LOCAL_TOOL_META[tool.name] || {},
		}))
		const { page, nextCursor } = paginate(tools, params?.cursor, TOOL_PAGE_SIZE)
		return {
			tools: page,
			...(nextCursor ? { nextCursor } : {}),
		}
	}

	private listPrompts(params: Record<string, unknown> | undefined) {
		const { page, nextCursor } = paginate(
			LOCAL_PROMPTS,
			params?.cursor,
			TOOL_PAGE_SIZE,
		)
		return {
			prompts: page,
			...(nextCursor ? { nextCursor } : {}),
		}
	}

	private getPrompt(params: Record<string, unknown> | undefined) {
		const name = typeof params?.name === 'string' ? params.name : ''
		const args =
			params?.arguments && typeof params.arguments === 'object'
				? (params.arguments as Record<string, unknown>)
				: {}
		const textArg = (key: string) =>
			typeof args[key] === 'string' ? (args[key] as string).trim() : ''
		switch (name) {
			case 'summarize_vault_note': {
				const path = textArg('path')
				if (!path) {
					throw new Error('summarize_vault_note requires path.')
				}
				return {
					description: 'Summarize one Obsidian vault note.',
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: `Read vault resource ${encodeVaultResourceUri(
									normalizePath(path),
								)} and summarize its key ideas, open questions, and useful next actions.`,
							},
						},
					],
				}
			}
			case 'search_vault': {
				const query = textArg('query')
				if (!query) {
					throw new Error('search_vault requires query.')
				}
				return {
					description: 'Search the current Obsidian vault.',
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: `Search the Obsidian vault for ${JSON.stringify(
									query,
								)}. Use available vault tools/resources, cite matching paths, and synthesize the answer.`,
							},
						},
					],
				}
			}
			case 'review_recent_notes':
				return {
					description: 'Review recently changed notes.',
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: 'Review recently changed Obsidian notes. Group findings by theme, point out follow-up tasks, and keep the digest concise.',
							},
						},
					],
				}
			default:
				throw new Error(`Unknown prompt: ${name}`)
		}
	}

	private listResourceFiles() {
		return this.plugin.app.vault
			.getFiles()
			.filter(isTextResource)
			.sort((left, right) => left.path.localeCompare(right.path))
	}

	private toVaultResource(file: TFile): VaultResourceInfo {
		return {
			uri: encodeVaultResourceUri(file.path),
			name: file.path,
			mimeType: getTextMimeType(file),
		}
	}

	private listResources(params: Record<string, unknown> | undefined) {
		const files = this.listResourceFiles()
		const { page, nextCursor } = paginate(
			files,
			params?.cursor,
			RESOURCE_PAGE_SIZE,
		)
		const resources = page.map((file) => this.toVaultResource(file))
		return {
			resources,
			...(nextCursor ? { nextCursor } : {}),
		}
	}

	private async readResource(params: Record<string, unknown> | undefined) {
		const uri = typeof params?.uri === 'string' ? params.uri : ''
		if (!uri) {
			throw new Error('resources/read requires a resource uri.')
		}
		const path = decodeVaultResourceUri(uri)
		const target = this.plugin.app.vault.getAbstractFileByPath(path)
		if (!(target instanceof TFile)) {
			throw new Error(`Vault resource not found: ${path}`)
		}
		if (!isTextResource(target)) {
			throw new Error(`Vault resource is not a supported text file: ${path}`)
		}
		await createPermissionGuard(
			this.plugin.app,
			() => this.plugin.settings,
		)({
			type: 'fs',
			fs: {
				kind: 'read',
				path: `${VAULT_MOUNT_POINT}/${path}`,
			},
		})
		return {
			contents: [
				{
					uri: encodeVaultResourceUri(target.path),
					mimeType: getTextMimeType(target),
					text: await this.plugin.app.vault.cachedRead(target),
				},
			],
		}
	}

	private subscribeResource(
		session: MCPSession,
		params: Record<string, unknown> | undefined,
	) {
		const uri = typeof params?.uri === 'string' ? params.uri : ''
		if (!uri) {
			throw new Error('resources/subscribe requires a resource uri.')
		}
		decodeVaultResourceUri(uri)
		session.subscriptions.add(uri)
		return {}
	}

	private unsubscribeResource(
		session: MCPSession,
		params: Record<string, unknown> | undefined,
	) {
		const uri = typeof params?.uri === 'string' ? params.uri : ''
		if (!uri) {
			throw new Error('resources/unsubscribe requires a resource uri.')
		}
		session.subscriptions.delete(uri)
		return {}
	}

	private broadcastNotification(
		method: string,
		params?: Record<string, unknown>,
	) {
		const notification = toJSONRPCNotification(method, params)
		for (const client of Array.from(this.sseClients)) {
			client.response.write?.(toSSEMessage(notification))
		}
	}

	private notifyResourceUpdated(uri: string) {
		for (const client of Array.from(this.sseClients)) {
			const session = this.sessions.get(client.sessionId)
			if (!session?.subscriptions.has(uri)) {
				continue
			}
			client.response.write?.(
				toSSEMessage(
					toJSONRPCNotification('notifications/resources/updated', { uri }),
				),
			)
		}
	}

	private async callTool(params: Record<string, unknown> | undefined) {
		const name = typeof params?.name === 'string' ? params.name : ''
		const args =
			params?.arguments && typeof params.arguments === 'object'
				? params.arguments
				: {}
		const tool = this.listTools().find((item) => item.name === name)
		if (!tool) {
			throw new Error(`Unknown tool: ${name}`)
		}
		const parser = tool.inputSchema as {
			parse?: (value: unknown) => unknown
		}
		const parsedArgs =
			typeof parser.parse === 'function' ? parser.parse(args) : args
		const result = await tool.execute(parsedArgs, this.createExecutionContext())
		return {
			content: [
				{
					type: 'text',
					text:
						typeof result.result === 'string'
							? result.result
							: JSON.stringify(result.result, null, 2),
				},
			],
			structuredContent:
				typeof result.result === 'string' ? undefined : result.result,
			_meta: {
				reversibleOps: result.reversibleOps || [],
			},
			isError:
				typeof result.result === 'object' &&
				!!(result.result as Record<string, unknown>).error,
		}
	}

	private createExecutionContext(): AIToolExecutionContext {
		const now = Date.now()
		const session: AISession = {
			id: 'mcp-local-server',
			createdAt: now,
			updatedAt: now,
			fragments: [],
			activeFragmentId: '',
			tasks: [],
		}
		return {
			session,
			depth: 0,
			maxDepth: 0,
		}
	}
}