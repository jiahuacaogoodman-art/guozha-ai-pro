import { z } from 'zod'
import { obsidianFetch } from './transport/obsidian-fetch'
import type { AIToolDefinition, ToolExecutionResult } from './types'

export interface MCPServerConfig {
	id: string
	name: string
	url: string
	enabled: boolean
	headers?: Record<string, string>
}

export const DEFAULT_MCP_PORT = 41733

export function normalizeMCPPort(value: unknown) {
	const port =
		typeof value === 'string'
			? Number(value)
			: typeof value === 'number'
				? value
				: DEFAULT_MCP_PORT
	return Number.isInteger(port) && port >= 1024 && port <= 65535
		? port
		: DEFAULT_MCP_PORT
}

export function createMCPToken() {
	const bytes = new Uint8Array(24)
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

interface JSONRPCResponse {
	jsonrpc?: string
	id?: string | number | null
	result?: unknown
	error?: {
		code?: number
		message?: string
		data?: unknown
	}
}

interface MCPToolInfo {
	name: string
	description?: string
	inputSchema?: Record<string, unknown>
}

interface MCPListToolsResult {
	tools?: MCPToolInfo[]
}

interface MCPToolContentPart {
	type?: string
	text?: string
	data?: string
	mimeType?: string
	resource?: unknown
	[key: string]: unknown
}

interface MCPCallToolResult {
	content?: MCPToolContentPart[]
	structuredContent?: unknown
	isError?: boolean
	[key: string]: unknown
}

interface MCPListResourcesResult {
	resources?: Array<Record<string, unknown>>
	nextCursor?: string
}

interface MCPReadResourceResult {
	contents?: Array<Record<string, unknown>>
}

interface MCPListPromptsResult {
	prompts?: Array<Record<string, unknown>>
	nextCursor?: string
}

interface MCPGetPromptResult {
	description?: string
	messages?: Array<Record<string, unknown>>
}

const emptySchema = z.object({})
const listResourcesSchema = {
	type: 'object',
	properties: {
		cursor: {
			type: 'string',
			description: 'Optional pagination cursor returned by a previous call.',
		},
	},
	additionalProperties: false,
}
const readResourceSchema = {
	type: 'object',
	properties: {
		uri: {
			type: 'string',
			description: 'Resource URI returned by the MCP resources/list method.',
		},
	},
	required: ['uri'],
	additionalProperties: false,
}
const listPromptsSchema = {
	type: 'object',
	properties: {
		cursor: {
			type: 'string',
			description: 'Optional pagination cursor returned by a previous call.',
		},
	},
	additionalProperties: false,
}
const getPromptSchema = {
	type: 'object',
	properties: {
		name: {
			type: 'string',
			description: 'Prompt name returned by the MCP prompts/list method.',
		},
		arguments: {
			type: 'object',
			description: 'Prompt arguments.',
			additionalProperties: true,
		},
	},
	required: ['name'],
	additionalProperties: false,
}

function sanitizeMCPId(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 48)
}

function sanitizeMCPToolName(serverId: string, toolName: string) {
	const safeServerId = sanitizeMCPId(serverId) || 'mcp'
	const safeToolName = sanitizeMCPId(toolName) || 'tool'
	return `mcp_${safeServerId}_${safeToolName}`.slice(0, 64)
}

function normalizeHeaders(headers?: Record<string, string>) {
	return Object.fromEntries(
		Object.entries(headers || {}).filter(
			([key, value]) => key.trim() && value.trim(),
		),
	)
}

function assertMCPURL(url: string) {
	const parsed = new URL(url)
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`Unsupported MCP URL protocol: ${parsed.protocol}`)
	}
	return parsed.toString()
}

function toResultObject(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object'
		? (value as Record<string, unknown>)
		: {}
}

function toListToolsResult(value: unknown): MCPListToolsResult {
	const result = toResultObject(value)
	if (!Array.isArray(result.tools)) {
		return {}
	}
	return {
		tools: result.tools.flatMap((tool) => {
			const item = toResultObject(tool)
			if (typeof item.name !== 'string') {
				return []
			}
			const inputSchema = toResultObject(item.inputSchema)
			return [
				{
					name: item.name,
					description:
						typeof item.description === 'string' ? item.description : undefined,
					inputSchema:
						Object.keys(inputSchema).length > 0 ? inputSchema : undefined,
				} satisfies MCPToolInfo,
			]
		}),
	}
}

function toCallToolResult(value: unknown): MCPCallToolResult {
	return { ...toResultObject(value) }
}

function toListResourcesResult(value: unknown): MCPListResourcesResult {
	const result = toResultObject(value)
	return {
		resources: Array.isArray(result.resources)
			? result.resources.map(toResultObject)
			: [],
		nextCursor:
			typeof result.nextCursor === 'string' ? result.nextCursor : undefined,
	}
}

function toReadResourceResult(value: unknown): MCPReadResourceResult {
	const result = toResultObject(value)
	return {
		contents: Array.isArray(result.contents)
			? result.contents.map(toResultObject)
			: [],
	}
}

function toListPromptsResult(value: unknown): MCPListPromptsResult {
	const result = toResultObject(value)
	return {
		prompts: Array.isArray(result.prompts)
			? result.prompts.map(toResultObject)
			: [],
		nextCursor:
			typeof result.nextCursor === 'string' ? result.nextCursor : undefined,
	}
}

function toGetPromptResult(value: unknown): MCPGetPromptResult {
	const result = toResultObject(value)
	return {
		description:
			typeof result.description === 'string' ? result.description : undefined,
		messages: Array.isArray(result.messages)
			? result.messages.map(toResultObject)
			: [],
	}
}

function extractMCPText(result: MCPCallToolResult) {
	const parts = Array.isArray(result.content) ? result.content : []
	const text = parts
		.map((part) => {
			if (part.type === 'text' && typeof part.text === 'string') {
				return part.text
			}
			if (part.type === 'image' || part.type === 'audio') {
				return `[${part.type}: ${part.mimeType || 'unknown media'}]`
			}
			if (part.type === 'resource') {
				return JSON.stringify(part.resource ?? part)
			}
			return Object.keys(part).length > 0 ? JSON.stringify(part) : ''
		})
		.filter(Boolean)
		.join('\n')
		.trim()

	if (text) {
		return text
	}
	if (result.structuredContent !== undefined) {
		return JSON.stringify(result.structuredContent, null, 2)
	}
	return JSON.stringify(result, null, 2)
}

export class MCPHttpClient {
	private nextId = 1
	private initialized = false
	private sessionId: string | undefined
	private capabilities: Record<string, unknown> = {}

	constructor(private server: MCPServerConfig) {}

	private headers() {
		return {
			accept: 'application/json, text/event-stream',
			'content-type': 'application/json',
			'mcp-protocol-version': '2025-06-18',
			...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
			...normalizeHeaders(this.server.headers),
		}
	}

	private parseResponse(text: string, id?: string | number) {
		const parseJSON = (value: string): JSONRPCResponse | undefined => {
			try {
				const parsed = JSON.parse(value) as unknown
				if (Array.isArray(parsed)) {
					return parsed
						.map((item) => toResultObject(item) as JSONRPCResponse)
						.find((item) => item.id === id || id === undefined)
				}
				return toResultObject(parsed) as JSONRPCResponse
			} catch {
				return undefined
			}
		}

		const direct = parseJSON(text)
		if (direct) {
			return direct
		}

		for (const event of text.split(/\n\n+/)) {
			const data = event
				.split('\n')
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trim())
				.join('\n')
				.trim()
			if (!data || data === '[DONE]') {
				continue
			}
			const parsed = parseJSON(data)
			if (parsed) {
				return parsed
			}
		}

		throw new Error('MCP response was not valid JSON-RPC.')
	}

	private async request(method: string, params?: Record<string, unknown>) {
		const id = this.nextId++
		const response = await obsidianFetch(assertMCPURL(this.server.url), {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify({
				jsonrpc: '2.0',
				id,
				method,
				params,
			}),
		})
		this.sessionId = response.headers.get('mcp-session-id') || this.sessionId
		const body = this.parseResponse(await response.text(), id)
		if (!response.ok) {
			throw new Error(
				`MCP request failed (${response.status} ${response.statusText})`,
			)
		}
		if (body.error) {
			throw new Error(
				body.error.message || `MCP error ${body.error.code ?? 'unknown'}`,
			)
		}
		return body.result
	}

	private async notify(method: string, params?: Record<string, unknown>) {
		const response = await obsidianFetch(assertMCPURL(this.server.url), {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify({
				jsonrpc: '2.0',
				method,
				params,
			}),
		})
		this.sessionId = response.headers.get('mcp-session-id') || this.sessionId
		if (!response.ok) {
			throw new Error(
				`MCP notification failed (${response.status} ${response.statusText})`,
			)
		}
	}

	async initialize() {
		if (this.initialized) {
			return
		}
		const result = toResultObject(
			await this.request('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: {
					name: 'guozha-ai-pro',
					version: process.env.PLUGIN_VERSION || '0.0.0',
				},
			}),
		)
		this.capabilities = toResultObject(result.capabilities)
		await this.notify('notifications/initialized')
		this.initialized = true
	}

	hasCapability(name: string) {
		return Boolean(
			Object.prototype.hasOwnProperty.call(this.capabilities, name),
		)
	}

	async listTools() {
		await this.initialize()
		return toListToolsResult(await this.request('tools/list')).tools || []
	}

	async callTool(name: string, args: unknown) {
		await this.initialize()
		return toCallToolResult(
			await this.request('tools/call', {
				name,
				arguments: args && typeof args === 'object' ? args : {},
			}),
		)
	}

	async listResources(cursor?: string) {
		await this.initialize()
		return toListResourcesResult(
			await this.request('resources/list', cursor ? { cursor } : undefined),
		)
	}

	async readResource(uri: string) {
		await this.initialize()
		return toReadResourceResult(
			await this.request('resources/read', {
				uri,
			}),
		)
	}

	async listPrompts(cursor?: string) {
		await this.initialize()
		return toListPromptsResult(
			await this.request('prompts/list', cursor ? { cursor } : undefined),
		)
	}

	async getPrompt(name: string, args?: Record<string, unknown>) {
		await this.initialize()
		return toGetPromptResult(
			await this.request('prompts/get', {
				name,
				arguments: args || {},
			}),
		)
	}
}

function createMCPResourceTools(
	server: MCPServerConfig,
	client: MCPHttpClient,
): AIToolDefinition[] {
	if (!client.hasCapability('resources')) {
		return []
	}
	const serverLabel = server.name || server.id
	return [
		{
			name: sanitizeMCPToolName(server.id || server.name, 'list_resources'),
			description: `List resources exposed by MCP server ${serverLabel}.`,
			inputSchema: listResourcesSchema as unknown as z.ZodType,
			execute: async (params): Promise<ToolExecutionResult> => {
				const args = toResultObject(params)
				return {
					result: {
						server: serverLabel,
						...(await client.listResources(
							typeof args.cursor === 'string' ? args.cursor : undefined,
						)),
					},
				}
			},
		},
		{
			name: sanitizeMCPToolName(server.id || server.name, 'read_resource'),
			description: `Read one resource exposed by MCP server ${serverLabel}.`,
			inputSchema: readResourceSchema as unknown as z.ZodType,
			execute: async (params): Promise<ToolExecutionResult> => {
				const args = toResultObject(params)
				if (typeof args.uri !== 'string' || !args.uri.trim()) {
					throw new Error('MCP resource uri is required.')
				}
				return {
					result: {
						server: serverLabel,
						...(await client.readResource(args.uri)),
					},
				}
			},
		},
	]
}

function createMCPPromptTools(
	server: MCPServerConfig,
	client: MCPHttpClient,
): AIToolDefinition[] {
	if (!client.hasCapability('prompts')) {
		return []
	}
	const serverLabel = server.name || server.id
	return [
		{
			name: sanitizeMCPToolName(server.id || server.name, 'list_prompts'),
			description: `List prompts exposed by MCP server ${serverLabel}.`,
			inputSchema: listPromptsSchema as unknown as z.ZodType,
			execute: async (params): Promise<ToolExecutionResult> => {
				const args = toResultObject(params)
				return {
					result: {
						server: serverLabel,
						...(await client.listPrompts(
							typeof args.cursor === 'string' ? args.cursor : undefined,
						)),
					},
				}
			},
		},
		{
			name: sanitizeMCPToolName(server.id || server.name, 'get_prompt'),
			description: `Get one prompt exposed by MCP server ${serverLabel}.`,
			inputSchema: getPromptSchema as unknown as z.ZodType,
			execute: async (params): Promise<ToolExecutionResult> => {
				const args = toResultObject(params)
				if (typeof args.name !== 'string' || !args.name.trim()) {
					throw new Error('MCP prompt name is required.')
				}
				const promptArgs =
					args.arguments && typeof args.arguments === 'object'
						? toResultObject(args.arguments)
						: {}
				return {
					result: {
						server: serverLabel,
						...(await client.getPrompt(args.name, promptArgs)),
					},
				}
			},
		},
	]
}

export async function createMCPTools(
	servers: MCPServerConfig[] | undefined,
): Promise<AIToolDefinition[]> {
	const enabledServers = (servers || []).filter(
		(server) => server.enabled && server.url.trim(),
	)
	const toolGroups = await Promise.all(
		enabledServers.map(async (server) => {
			const client = new MCPHttpClient(server)
			await client.initialize()
			const tools = client.hasCapability('tools')
				? await client.listTools()
				: []
			const exposedTools = tools.map((tool): AIToolDefinition => {
				const exposedName = sanitizeMCPToolName(
					server.id || server.name,
					tool.name,
				)
				return {
					name: exposedName,
					description: [
						tool.description || `Call MCP tool ${tool.name}.`,
						`Source MCP server: ${server.name || server.id}.`,
					].join('\n'),
					inputSchema: (tool.inputSchema || emptySchema) as z.ZodType,
					execute: async (params): Promise<ToolExecutionResult> => {
						const result = await client.callTool(tool.name, params)
						const payload = {
							server: server.name || server.id,
							tool: tool.name,
							isError: !!result.isError,
							structuredContent: result.structuredContent,
							content: extractMCPText(result),
						}
						return {
							result: result.isError
								? {
										error: payload.content,
										...payload,
									}
								: payload,
						}
					},
				}
			})
			return [
				...exposedTools,
				...createMCPResourceTools(server, client),
				...createMCPPromptTools(server, client),
			]
		}),
	)
	return toolGroups.flat()
}

export function createMCPServerConfig(
	server: Partial<MCPServerConfig> = {},
): MCPServerConfig {
	const name = server.name?.trim() || 'MCP Server'
	return {
		id: server.id?.trim() || sanitizeMCPId(name) || `mcp_${Date.now()}`,
		name,
		url: server.url?.trim() || '',
		enabled: server.enabled ?? true,
		headers: normalizeHeaders(server.headers),
	}
}