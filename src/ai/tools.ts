import { App, normalizePath, TFile } from 'obsidian'
import { posix as pathPosix } from 'path-browserify'
import { z } from 'zod'
import { execVaultBash, VAULT_MOUNT_POINT } from '~/ai/bash/runtime'
import i18n from '~/i18n'
import type { PermissionGuard } from './permission-guard'
import { AIToolDefinition, ToolExecutionResult } from './types'

interface ReplaceResult {
	content: string
	matchCount: number
}

function encodeTextBase64(content: string) {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(content).toString('base64')
	}
	return btoa(String.fromCharCode(...new TextEncoder().encode(content)))
}

const textValue = (field: string) =>
	z.string({
		error: () => i18n.t('chatbox.errors.toolFieldRequired', { field }),
	})

const booleanValue = (field: string) =>
	z.preprocess(
		(value) => {
			if (typeof value === 'boolean') {
				return value
			}
			if (typeof value === 'string') {
				const normalized = value.trim().toLowerCase()
				if (normalized === 'true') {
					return true
				}
				if (normalized === 'false') {
					return false
				}
			}
			return value
		},
		z.boolean(i18n.t('chatbox.errors.toolFieldRequired', { field })),
	)

function isAllowedBashCwd(pathValue: string) {
	const normalized = pathPosix.normalize(
		pathPosix.resolve('/', pathValue || '/'),
	)
	return (
		normalized === '/' ||
		normalized === VAULT_MOUNT_POINT ||
		normalized.startsWith(`${VAULT_MOUNT_POINT}/`)
	)
}

interface SpawnToolHandler {
	(params: {
		prompt: string
		title?: string
		parentTaskId?: string
		depth: number
		maxDepth: number
		sessionId: string
	}): Promise<Record<string, unknown>>
}

interface CreateAIToolsOptions {
	spawnTask?: SpawnToolHandler
	allowSpawn?: boolean
	permissionGuard?: PermissionGuard
}

function replaceUniqueOccurrence(
	content: string,
	oldText: string,
	newText: string,
) {
	let matchIndex = content.indexOf(oldText)
	let matchCount = 0

	while (matchIndex !== -1) {
		matchCount += 1
		if (matchCount > 1) {
			break
		}
		matchIndex = content.indexOf(oldText, matchIndex + oldText.length)
	}

	if (matchCount === 0) {
		throw new Error(i18n.t('chatbox.errors.editMatchNotFound'))
	}
	if (matchCount > 1) {
		throw new Error(i18n.t('chatbox.errors.editMatchNotUnique'))
	}

	return {
		content: content.replace(oldText, newText),
		matchCount,
	} satisfies ReplaceResult
}

function normalizeVaultToolPath(path: string, toolName: string) {
	if (path.startsWith('/') && !path.startsWith(`${VAULT_MOUNT_POINT}/`)) {
		throw new Error(
			`${toolName} can only access files inside the vault. Use a vault-relative path (e.g. notes/file.md) or an absolute virtual path under ${VAULT_MOUNT_POINT}/ (e.g. ${VAULT_MOUNT_POINT}/notes/file.md).`,
		)
	}
	const strippedPath = path.startsWith(`${VAULT_MOUNT_POINT}/`)
		? path.slice(VAULT_MOUNT_POINT.length)
		: path
	return normalizePath(strippedPath)
}

async function readVaultTextFile(app: App, path: string) {
	const target = app.vault.getAbstractFileByPath(path)
	if (target) {
		if (!(target instanceof TFile)) {
			throw new Error(i18n.t('chatbox.errors.notFile', { path }))
		}
		return await app.vault.cachedRead(target)
	}

	const stat = await app.vault.adapter.stat(path)
	if (!stat) {
		throw new Error(i18n.t('chatbox.errors.fileNotFound', { path }))
	}
	if (stat.type !== 'file') {
		throw new Error(i18n.t('chatbox.errors.notFile', { path }))
	}
	return await app.vault.adapter.read(path)
}

export function createAITools(
	app: App,
	options: CreateAIToolsOptions = {},
): AIToolDefinition[] {
	const { permissionGuard } = options
	const tools: AIToolDefinition[] = [
		{
			name: 'read_file',
			description:
				'Read a vault text file and return its contents. The path can be a vault-relative path (e.g. notes/file.md) or an absolute virtual path (e.g. /vault/notes/file.md).',
			inputSchema: z.object({
				path: z
					.string()
					.trim()
					.min(
						1,
						i18n.t('chatbox.errors.toolFieldRequired', { field: 'path' }),
					),
			}),
			execute: async (params): Promise<ToolExecutionResult> => {
				const path = params.path
				const normalizedPath = normalizeVaultToolPath(path, 'read_file')

				await permissionGuard?.({
					type: 'fs',
					fs: {
						kind: 'read',
						path: `${VAULT_MOUNT_POINT}/${normalizedPath}`,
					},
				})

				return {
					result: {
						path: normalizedPath,
						content: await readVaultTextFile(app, normalizedPath),
					},
				}
			},
		},
		{
			name: 'edit_file',
			description:
				'Edit a vault text file by replacing one exact, uniquely matched text block with new text. The path can be a vault-relative path (e.g. notes/file.md) or an absolute virtual path (e.g. /vault/notes/file.md).',
			inputSchema: z.object({
				path: z
					.string()
					.trim()
					.min(
						1,
						i18n.t('chatbox.errors.toolFieldRequired', { field: 'path' }),
					),
				oldText: z
					.string()
					.min(
						1,
						i18n.t('chatbox.errors.toolFieldRequired', { field: 'oldText' }),
					),
				newText: textValue('newText'),
			}),
			execute: async (params): Promise<ToolExecutionResult> => {
				const path = params.path
				const oldText = params.oldText
				const newText = params.newText
				const normalizedPath = normalizeVaultToolPath(path, 'edit_file')

				await permissionGuard?.({
					type: 'fs',
					fs: {
						kind: 'edit',
						path: `${VAULT_MOUNT_POINT}/${normalizedPath}`,
					},
				})

				const target = app.vault.getAbstractFileByPath(normalizedPath)

				if (!target) {
					throw new Error(i18n.t('chatbox.errors.fileNotFound', { path }))
				}
				if (!(target instanceof TFile)) {
					throw new Error(i18n.t('chatbox.errors.notFile', { path }))
				}

				const content = await app.vault.cachedRead(target)
				const replaced = replaceUniqueOccurrence(content, oldText, newText)
				await app.vault.modify(target, replaced.content)

				return {
					result: {
						path: normalizedPath,
						replaced: true,
						matchCount: replaced.matchCount,
					},
					reversibleOps: [
						{
							vaultPath: normalizedPath,
							operation: 'update',
							before: {
								kind: 'file',
								contentBase64: encodeTextBase64(content),
							},
						},
					],
				}
			},
		},
		{
			name: 'bash',
			description:
				"Execute bash against a virtual filesystem where the Obsidian vault is mounted at /vault. Use standard shell commands like ls, cat, rg, mkdir, mv, cp, and rm. Treat /vault as the user's personal knowledge base — only write there for content the user intends to keep; use /tmp for intermediate or scratch work.",
			inputSchema: z.object({
				script: textValue('script'),
				cwd: z.string().default(VAULT_MOUNT_POINT),
				stdin: z.string().optional(),
				rawScript: booleanValue('rawScript').default(false),
			}),
			execute: async (params): Promise<ToolExecutionResult> => {
				const cwd = params.cwd || VAULT_MOUNT_POINT
				if (!isAllowedBashCwd(cwd)) {
					throw new Error(
						`Invalid bash cwd: ${cwd}. Allowed roots are / and ${VAULT_MOUNT_POINT}`,
					)
				}

				const result = await execVaultBash(app, params.script, {
					cwd,
					stdin: params.stdin,
					rawScript: params.rawScript,
					permissionGuard,
				})

				const truncateLine = (line: string) =>
					line.length > 2000
						? `${line.slice(0, 2000)}...[line truncated: ${line.length} chars total]`
						: line

				const processOutput = (text: string) =>
					text.split('\n').map(truncateLine).join('\n')

				return {
					result: `${processOutput(result.stdout)}${processOutput(result.stderr)}`,
					reversibleOps: result.reversibleOps,
				}
			},
		},
	]

	if (options.spawnTask && options.allowSpawn !== false) {
		tools.push({
			name: 'spawn',
			description:
				'Run a large independent background task and return its task result when finished.',
			inputSchema: z.object({
				task: z
					.string()
					.trim()
					.min(
						1,
						i18n.t('chatbox.errors.toolFieldRequired', { field: 'task' }),
					),
				label: z.string().trim().optional(),
			}),
			execute: async (params, context): Promise<ToolExecutionResult> => {
				return {
					result: await options.spawnTask!({
						prompt: params.task,
						title: params.label,
						parentTaskId: context.parentTaskId,
						depth: context.depth + 1,
						maxDepth: context.maxDepth,
						sessionId: context.session.id,
					}),
				}
			},
		})
	}

	return tools
}
