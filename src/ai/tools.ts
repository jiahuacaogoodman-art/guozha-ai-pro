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

type VaultTextFile =
	| {
			source: 'indexed'
			file: TFile
			content: string
	  }
	| {
			source: 'adapter'
			path: string
			content: string
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

const readFileInputSchema = z.object({
	path: z
		.string()
		.trim()
		.min(1, i18n.t('chatbox.errors.toolFieldRequired', { field: 'path' })),
})

const editFileInputSchema = z.object({
	path: z
		.string()
		.trim()
		.min(1, i18n.t('chatbox.errors.toolFieldRequired', { field: 'path' })),
	oldText: z
		.string()
		.min(1, i18n.t('chatbox.errors.toolFieldRequired', { field: 'oldText' })),
	newText: textValue('newText'),
})

const writeFileInputSchema = z.object({
	path: z
		.string()
		.trim()
		.min(1, i18n.t('chatbox.errors.toolFieldRequired', { field: 'path' })),
	content: textValue('content'),
})

const bashInputSchema = z.object({
	script: textValue('script'),
	cwd: z.string().default(VAULT_MOUNT_POINT),
	stdin: z.string().optional(),
	rawScript: booleanValue('rawScript').default(false),
})

const spawnInputSchema = z.object({
	task: z
		.string()
		.trim()
		.min(1, i18n.t('chatbox.errors.toolFieldRequired', { field: 'task' })),
	label: z.string().trim().optional(),
})

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
		? path.slice(VAULT_MOUNT_POINT.length + 1)
		: path
	return normalizePath(strippedPath)
}

async function mkdirsAdapter(app: App, path: string) {
	const normalized = normalizePath(path)
	if (!normalized || normalized === '.' || normalized === '/') {
		return
	}
	const parts = normalized.split('/').filter(Boolean)
	let current = ''
	for (const part of parts) {
		current = current ? `${current}/${part}` : part
		const stat = await app.vault.adapter.stat(current)
		if (!stat) {
			await app.vault.adapter.mkdir(current)
		}
	}
}

async function loadVaultTextFile(
	app: App,
	path: string,
): Promise<VaultTextFile> {
	const target = app.vault.getAbstractFileByPath(path)
	if (target) {
		if (!(target instanceof TFile)) {
			throw new Error(i18n.t('chatbox.errors.notFile', { path }))
		}
		return {
			source: 'indexed',
			file: target,
			content: await app.vault.cachedRead(target),
		}
	}

	const stat = await app.vault.adapter.stat(path)
	if (!stat) {
		throw new Error(i18n.t('chatbox.errors.fileNotFound', { path }))
	}
	if (stat.type !== 'file') {
		throw new Error(i18n.t('chatbox.errors.notFile', { path }))
	}
	return {
		source: 'adapter',
		path,
		content: await app.vault.adapter.read(path),
	}
}

async function readVaultTextFile(app: App, path: string) {
	return (await loadVaultTextFile(app, path)).content
}

async function writeVaultTextFile(
	app: App,
	target: VaultTextFile,
	content: string,
) {
	const targetPath =
		target.source === 'indexed' ? target.file.path : target.path
	if ((await writeOpenMarkdownEditor(app, targetPath, content)) !== undefined) {
		return
	}
	if (target.source === 'indexed') {
		await app.vault.modify(target.file, content)
		return
	}
	await app.vault.adapter.write(target.path, content)
}

async function writeVaultTextFileByPath(
	app: App,
	path: string,
	content: string,
) {
	const openEditorBefore = await writeOpenMarkdownEditor(app, path, content)
	if (openEditorBefore !== undefined) {
		return {
			created: false,
			before: openEditorBefore,
		}
	}

	const target = app.vault.getAbstractFileByPath(path)
	if (target) {
		if (!(target instanceof TFile)) {
			throw new Error(i18n.t('chatbox.errors.notFile', { path }))
		}
		const before = await app.vault.cachedRead(target)
		await app.vault.modify(target, content)
		return {
			created: false,
			before,
		}
	}

	const stat = await app.vault.adapter.stat(path)
	if (stat) {
		if (stat.type !== 'file') {
			throw new Error(i18n.t('chatbox.errors.notFile', { path }))
		}
		const before = await app.vault.adapter.read(path)
		await app.vault.adapter.write(path, content)
		return {
			created: false,
			before,
		}
	}

	const parent = pathPosix.dirname(path)
	if (parent && parent !== '.') {
		await mkdirsAdapter(app, parent)
	}
	await app.vault.adapter.write(path, content)
	return {
		created: true,
		before: undefined,
	}
}

async function writeOpenMarkdownEditor(
	app: App,
	path: string | undefined,
	content: string,
) {
	if (!path) {
		return undefined
	}
	const normalizedPath = normalizePath(path)
	const leaves = app.workspace?.getLeavesOfType?.('markdown') ?? []
	for (const leaf of leaves) {
		const view = leaf.view
		if (
			!view ||
			typeof view !== 'object' ||
			!('file' in view) ||
			!('editor' in view)
		) {
			continue
		}
		const candidate = view as {
			file?: { path?: string }
			editor?: {
				getValue?: () => string
				setValue?: (content: string) => void
			}
		}
		if (
			candidate.file?.path !== normalizedPath ||
			typeof candidate.editor?.getValue !== 'function' ||
			typeof candidate.editor.setValue !== 'function'
		) {
			continue
		}
		const before = candidate.editor.getValue()
		candidate.editor.setValue(content)
		return before
	}
	return undefined
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
			inputSchema: readFileInputSchema,
			execute: async (params): Promise<ToolExecutionResult> => {
				const { path } = readFileInputSchema.parse(params)
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
			inputSchema: editFileInputSchema,
			execute: async (params): Promise<ToolExecutionResult> => {
				const { path, oldText, newText } = editFileInputSchema.parse(params)
				const normalizedPath = normalizeVaultToolPath(path, 'edit_file')

				await permissionGuard?.({
					type: 'fs',
					fs: {
						kind: 'edit',
						path: `${VAULT_MOUNT_POINT}/${normalizedPath}`,
					},
				})

				const target = await loadVaultTextFile(app, normalizedPath)
				const content = target.content
				const replaced = replaceUniqueOccurrence(content, oldText, newText)
				await writeVaultTextFile(app, target, replaced.content)

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
			name: 'write_file',
			description:
				'Create or replace an entire vault text file with the provided content. Use this after read_file when the user asks to rewrite, polish, format, summarize into, or otherwise update the current note/file and exact edit_file matching would be brittle. The path can be vault-relative (e.g. notes/file.md) or an absolute virtual path (e.g. /vault/notes/file.md).',
			inputSchema: writeFileInputSchema,
			execute: async (params): Promise<ToolExecutionResult> => {
				const { path, content } = writeFileInputSchema.parse(params)
				const normalizedPath = normalizeVaultToolPath(path, 'write_file')

				await permissionGuard?.({
					type: 'fs',
					fs: {
						kind: 'write',
						path: `${VAULT_MOUNT_POINT}/${normalizedPath}`,
					},
				})

				const result = await writeVaultTextFileByPath(
					app,
					normalizedPath,
					content,
				)
				const reversibleOp = result.created
					? {
							vaultPath: normalizedPath,
							operation: 'create' as const,
							before: { kind: 'file' as const },
						}
					: {
							vaultPath: normalizedPath,
							operation: 'update' as const,
							before: {
								kind: 'file' as const,
								contentBase64: encodeTextBase64(result.before || ''),
							},
						}

				return {
					result: {
						path: normalizedPath,
						written: true,
						created: result.created,
					},
					reversibleOps: [reversibleOp],
				}
			},
		},
		{
			name: 'bash',
			description:
				"Execute bash against a virtual filesystem where the Obsidian vault is mounted at /vault. Use standard shell commands like ls, cat, rg, mkdir, mv, cp, and rm. Treat /vault as the user's personal knowledge base — only write there for content the user intends to keep; use /tmp for intermediate or scratch work.",
			inputSchema: bashInputSchema,
			execute: async (params): Promise<ToolExecutionResult> => {
				const { cwd, script, stdin, rawScript } = bashInputSchema.parse(params)
				if (!isAllowedBashCwd(cwd)) {
					throw new Error(
						`Invalid bash cwd: ${cwd}. Allowed roots are / and ${VAULT_MOUNT_POINT}`,
					)
				}

				const result = await execVaultBash(app, script, {
					cwd,
					stdin,
					rawScript,
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
			inputSchema: spawnInputSchema,
			execute: async (params, context): Promise<ToolExecutionResult> => {
				const { task, label } = spawnInputSchema.parse(params)
				return {
					result: await options.spawnTask!({
						prompt: task,
						title: label,
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