import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMCPTools } from './mcp'

const transportMocks = vi.hoisted(() => ({
	obsidianFetch: vi.fn(),
}))

vi.mock('./transport/obsidian-fetch', () => transportMocks)

function jsonResponse(body: unknown, headers?: Record<string, string>) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers,
	})
}

describe('createMCPTools', () => {
	beforeEach(() => {
		transportMocks.obsidianFetch.mockReset()
	})

	it('discovers MCP tools and forwards tool calls with the negotiated session id', async () => {
		transportMocks.obsidianFetch
			.mockResolvedValueOnce(
				jsonResponse(
					{
						jsonrpc: '2.0',
						id: 1,
						result: {
							protocolVersion: '2025-06-18',
							capabilities: { tools: {} },
						},
					},
					{ 'mcp-session-id': 'session-1' },
				),
			)
			.mockResolvedValueOnce(new Response('', { status: 202 }))
			.mockResolvedValueOnce(
				jsonResponse({
					jsonrpc: '2.0',
					id: 2,
					result: {
						tools: [
							{
								name: 'search',
								description: 'Search notes',
								inputSchema: {
									type: 'object',
									properties: {
										query: { type: 'string' },
									},
									required: ['query'],
								},
							},
						],
					},
				}),
			)

		const tools = await createMCPTools([
			{
				id: 'notes',
				name: 'Notes',
				url: 'https://example.com/mcp',
				enabled: true,
			},
		])

		expect(tools).toHaveLength(1)
		expect(tools[0].name).toBe('mcp_notes_search')
		expect(
			transportMocks.obsidianFetch.mock.calls[2][1]?.headers,
		).toMatchObject({
			'mcp-session-id': 'session-1',
		})

		transportMocks.obsidianFetch.mockResolvedValueOnce(
			jsonResponse({
				jsonrpc: '2.0',
				id: 3,
				result: {
					content: [{ type: 'text', text: 'found note' }],
					structuredContent: { count: 1 },
				},
			}),
		)

		const result = await tools[0].execute({ query: 'todo' }, {} as never)

		expect(result.result).toMatchObject({
			server: 'Notes',
			tool: 'search',
			isError: false,
			content: 'found note',
			structuredContent: { count: 1 },
		})
		expect(
			JSON.parse(transportMocks.obsidianFetch.mock.calls[3][1]?.body as string),
		).toMatchObject({
			method: 'tools/call',
			params: {
				name: 'search',
				arguments: { query: 'todo' },
			},
		})
	})

	it('exposes MCP resources as chat tools when the server supports resources', async () => {
		transportMocks.obsidianFetch
			.mockResolvedValueOnce(
				jsonResponse(
					{
						jsonrpc: '2.0',
						id: 1,
						result: {
							protocolVersion: '2025-06-18',
							capabilities: {
								tools: {},
								resources: {},
							},
						},
					},
					{ 'mcp-session-id': 'session-2' },
				),
			)
			.mockResolvedValueOnce(new Response('', { status: 202 }))
			.mockResolvedValueOnce(
				jsonResponse({
					jsonrpc: '2.0',
					id: 2,
					result: {
						tools: [],
					},
				}),
			)

		const tools = await createMCPTools([
			{
				id: 'docs',
				name: 'Docs',
				url: 'https://example.com/mcp',
				enabled: true,
			},
		])

		expect(tools.map((tool) => tool.name)).toEqual([
			'mcp_docs_list_resources',
			'mcp_docs_read_resource',
		])

		transportMocks.obsidianFetch.mockResolvedValueOnce(
			jsonResponse({
				jsonrpc: '2.0',
				id: 3,
				result: {
					resources: [
						{
							uri: 'vault:///note.md',
							name: 'note.md',
						},
					],
					nextCursor: '1',
				},
			}),
		)

		await expect(tools[0].execute({}, {} as never)).resolves.toMatchObject({
			result: {
				server: 'Docs',
				resources: [{ uri: 'vault:///note.md', name: 'note.md' }],
				nextCursor: '1',
			},
		})

		transportMocks.obsidianFetch.mockResolvedValueOnce(
			jsonResponse({
				jsonrpc: '2.0',
				id: 4,
				result: {
					contents: [
						{
							uri: 'vault:///note.md',
							mimeType: 'text/markdown',
							text: '# Note',
						},
					],
				},
			}),
		)

		await expect(
			tools[1].execute({ uri: 'vault:///note.md' }, {} as never),
		).resolves.toMatchObject({
			result: {
				server: 'Docs',
				contents: [{ text: '# Note' }],
			},
		})
	})

	it('exposes MCP prompts as chat tools when the server supports prompts', async () => {
		transportMocks.obsidianFetch
			.mockResolvedValueOnce(
				jsonResponse({
					jsonrpc: '2.0',
					id: 1,
					result: {
						protocolVersion: '2025-06-18',
						capabilities: {
							prompts: {},
						},
					},
				}),
			)
			.mockResolvedValueOnce(new Response('', { status: 202 }))

		const tools = await createMCPTools([
			{
				id: 'promptbox',
				name: 'PromptBox',
				url: 'https://example.com/mcp',
				enabled: true,
			},
		])

		expect(tools.map((tool) => tool.name)).toEqual([
			'mcp_promptbox_list_prompts',
			'mcp_promptbox_get_prompt',
		])

		transportMocks.obsidianFetch.mockResolvedValueOnce(
			jsonResponse({
				jsonrpc: '2.0',
				id: 2,
				result: {
					prompts: [{ name: 'summarize', description: 'Summarize text' }],
				},
			}),
		)

		await expect(tools[0].execute({}, {} as never)).resolves.toMatchObject({
			result: {
				server: 'PromptBox',
				prompts: [{ name: 'summarize' }],
			},
		})

		transportMocks.obsidianFetch.mockResolvedValueOnce(
			jsonResponse({
				jsonrpc: '2.0',
				id: 3,
				result: {
					description: 'Summarize text',
					messages: [
						{
							role: 'user',
							content: { type: 'text', text: 'Summarize this.' },
						},
					],
				},
			}),
		)

		await expect(
			tools[1].execute(
				{ name: 'summarize', arguments: { tone: 'short' } },
				{} as never,
			),
		).resolves.toMatchObject({
			result: {
				server: 'PromptBox',
				description: 'Summarize text',
				messages: [{ role: 'user' }],
			},
		})
	})
})