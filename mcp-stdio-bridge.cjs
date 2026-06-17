#!/usr/bin/env node
'use strict'

const http = require('http')
const readline = require('readline')

const endpoint = process.env.GUOZHA_MCP_URL || 'http://localhost:41733/mcp'
const token = process.env.GUOZHA_MCP_TOKEN || ''
let sessionId = process.env.GUOZHA_MCP_SESSION_ID || ''

function requestJSON(payload) {
	return new Promise((resolve, reject) => {
		const url = new URL(endpoint)
		const body = JSON.stringify(payload)
		const request = http.request(
			{
				protocol: url.protocol,
				hostname: url.hostname,
				port: url.port || 80,
				path: `${url.pathname}${url.search}`,
				method: 'POST',
				headers: {
					accept: 'application/json, text/event-stream',
					'content-type': 'application/json',
					'content-length': Buffer.byteLength(body),
					'mcp-protocol-version': '2025-06-18',
					...(sessionId ? { 'mcp-session-id': sessionId } : {}),
					...(token ? { authorization: `Bearer ${token}` } : {}),
				},
			},
			(response) => {
				sessionId = response.headers['mcp-session-id'] || sessionId
				const chunks = []
				response.on('data', (chunk) => chunks.push(chunk))
				response.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8').trim()
					if (response.statusCode < 200 || response.statusCode >= 300) {
						reject(new Error(text || `HTTP ${response.statusCode}`))
						return
					}
					if (!text) {
						resolve(undefined)
						return
					}
					resolve(parseMCPResponse(text))
				})
			},
		)
		request.on('error', reject)
		request.write(body)
		request.end()
	})
}

function parseMCPResponse(text) {
	try {
		return JSON.parse(text)
	} catch {
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
			return JSON.parse(data)
		}
		throw new Error('MCP HTTP response was not JSON-RPC.')
	}
}

function toErrorResponse(id, error) {
	return {
		jsonrpc: '2.0',
		id: id ?? null,
		error: {
			code: -32000,
			message: error instanceof Error ? error.message : String(error),
		},
	}
}

const rl = readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
})

rl.on('line', async (line) => {
	const trimmed = line.trim()
	if (!trimmed) {
		return
	}
	let payload
	try {
		payload = JSON.parse(trimmed)
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify(toErrorResponse(null, 'Invalid JSON-RPC payload'))}\n`,
		)
		return
	}
	try {
		const response = await requestJSON(payload)
		if (response !== undefined) {
			process.stdout.write(`${JSON.stringify(response)}\n`)
		}
	} catch (error) {
		process.stdout.write(`${JSON.stringify(toErrorResponse(payload.id, error))}\n`)
	}
})