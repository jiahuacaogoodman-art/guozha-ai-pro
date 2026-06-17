import { Prec, RangeSetBuilder } from '@codemirror/state'
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view'
import { MarkdownView } from 'obsidian'
import type NutstorePlugin from '..'
import { getErrorMessage } from '~/utils/async-helpers'
import logger from '~/utils/logger'

const USER_PROMPT = '你：'
const ASSISTANT_PROMPT = '果札：'
const TURN_SEPARATOR = '    '
const INLINE_GREETING = `${ASSISTANT_PROMPT}你好。${TURN_SEPARATOR}${USER_PROMPT}`
const INLINE_HISTORY_COMMENT_PREFIX = 'guozha-inline-chat:'
const INLINE_HISTORY_COMMENT_RE =
	/<!--\s*guozha-inline-chat:([A-Za-z0-9+/=]+)\s*-->/g

type InlineAIRole = 'user' | 'assistant'

interface InlineAIMessage {
	role: InlineAIRole
	text: string
	createdAt: number
}

interface InlineAIHistoryPayload {
	version: 1
	id: string
	createdAt: number
	updatedAt: number
	text: string
	messages: InlineAIMessage[]
}

interface InlineAIActiveResponse {
	id: string
	contextPosition: number
	messages: InlineAIMessage[]
	useTools: boolean
	selectionText?: string
	responseStart: number
	responseEnd: number
	lastPaintedAt: number
}

interface InlineAIDecoration {
	from: number
	to: number
	value: Decoration
}

interface InlineAIPromptRange {
	from: number
	to: number
	role: InlineAIRole
}

interface InlineAIPromptMatch {
	index: number
	prompt: typeof USER_PROMPT | typeof ASSISTANT_PROMPT
	role: InlineAIRole
}

type InlineHistoryDeleteKey = 'Backspace' | 'Delete'

function createInlineId() {
	return `inline-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`
}

function promptRole(prompt: string): InlineAIRole {
	return prompt === USER_PROMPT ? 'user' : 'assistant'
}

function createPromptRegex() {
	return new RegExp(`${ASSISTANT_PROMPT}|${USER_PROMPT}`, 'g')
}

function getPromptMatches(text: string, before = text.length) {
	const matches: InlineAIPromptMatch[] = []
	const regex = createPromptRegex()
	let match: RegExpExecArray | null
	while ((match = regex.exec(text)) !== null) {
		if (match.index > before) {
			break
		}
		const prompt = match[0] as typeof USER_PROMPT | typeof ASSISTANT_PROMPT
		matches.push({
			index: match.index,
			prompt,
			role: promptRole(prompt),
		})
	}
	return matches
}

function findLastPromptBefore(text: string, before: number) {
	const matches = getPromptMatches(text, Math.max(0, before - 1))
	return matches[matches.length - 1]
}

function findSegmentStart(text: string, before: number) {
	const matches = getPromptMatches(text, Math.max(0, before - 1))
	return matches.length > 0 ? matches[0].index : undefined
}

export function parseInlineMessages(text: string) {
	const matches = getPromptMatches(text)
	const messages: InlineAIMessage[] = []
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index]
		const contentFrom = match.index + match.prompt.length
		const contentTo = matches[index + 1]?.index ?? text.length
		const content = text.slice(contentFrom, contentTo).trim()
		if (!content) {
			continue
		}
		if (
			messages.length === 0 &&
			match.role === 'assistant' &&
			content === '你好。'
		) {
			continue
		}
		messages.push({
			role: match.role,
			text: content,
			createdAt: Date.now(),
		})
	}
	return messages
}

function createHistoryPreview(payload: InlineAIHistoryPayload) {
	const latestUserMessage = [...payload.messages]
		.reverse()
		.find((message) => message.role === 'user')
	const latestAssistantMessage = [...payload.messages]
		.reverse()
		.find((message) => message.role === 'assistant')
	const previewSource =
		latestUserMessage?.text || latestAssistantMessage?.text || payload.text
	const preview = previewSource.replace(/\s+/g, ' ').trim()
	return preview.length > 42 ? `${preview.slice(0, 42)}...` : preview
}

function createHistoryContextSummary(payload: InlineAIHistoryPayload) {
	const messages = payload.messages.length
		? payload.messages
		: parseInlineMessages(payload.text)
	const latest = messages.slice(-4)
	if (!latest.length) {
		return '[果札对话历史]'
	}
	return `[果札对话历史：${latest
		.map(
			(message) =>
				`${message.role === 'assistant' ? '果札' : '用户'}：${message.text}`,
		)
		.join('；')}]`
}

export function normalizeInlineReply(text: string) {
	return text
		.replace(/\s*\n+\s*/g, ' ')
		.replace(/\s{5,}/g, TURN_SEPARATOR)
		.trim()
}

export function shouldUseToolsForInline(input: string) {
	const normalized = input.trim().toLowerCase()
	if (!normalized) {
		return false
	}
	const actionKeywords = [
		'改',
		'修改',
		'改写',
		'编辑',
		'整理',
		'美化',
		'润色',
		'优化',
		'完善',
		'校对',
		'纠错',
		'重写',
		'续写',
		'扩写',
		'缩写',
		'做表',
		'制表',
		'生成表',
		'表格',
		'翻译并替换',
		'总结到',
		'写入',
		'插入',
		'追加',
		'添加',
		'补充',
		'替换',
		'删除',
		'新建',
		'创建',
		'移动',
		'重命名',
		'复制',
		'读取',
		'检查',
		'测试',
		'运行',
		'构建',
		'打包',
		'发布',
		'安装',
		'导出',
		'修复',
		'排查',
		'调试',
		'查找',
		'搜索',
		'列出',
		'同步',
		'格式化',
		'保存',
		'归档',
		'拆分',
		'合并',
		'fix',
		'edit',
		'modify',
		'rewrite',
		'create',
		'delete',
		'move',
		'rename',
		'write',
		'append',
		'format',
		'sync',
		'search',
		'find',
		'read',
		'check',
		'test',
		'run',
		'build',
		'package',
		'publish',
		'release',
		'install',
		'export',
		'debug',
		'save',
		'insert',
		'replace',
		'table',
	]
	if (actionKeywords.some((keyword) => normalized.includes(keyword))) {
		return true
	}
	const fileSignals = [
		'当前笔记',
		'当前文件',
		'这个文件',
		'这个笔记',
		'本文件',
		'本笔记',
		'在文件里',
		'在笔记里',
		'文件里',
		'笔记里',
		'全文',
		'文稿',
		'标题',
		'这段',
		'选中',
		'笔记',
		'文件',
		'目录',
		'.md',
		'vault',
	]
	const weakRequest = [
		'帮我',
		'替我',
		'为我',
		'给我',
		'让你',
		'把',
		'将',
		'请',
	].some((keyword) => normalized.includes(keyword))
	return (
		weakRequest &&
		fileSignals.some((keyword) => normalized.includes(keyword)) &&
		!/(讲讲|解释|为什么|是什么|什么是|怎么理解|科普)/.test(normalized)
	)
}

export function getInlinePromptRanges(docText: string) {
	const ranges: InlineAIPromptRange[] = []
	let lineFrom = 0
	for (const line of docText.split('\n')) {
		const matches = getPromptMatches(line)
		const isInlineConversation =
			matches.some((match) => match.role === 'assistant') &&
			matches.some((match) => match.role === 'user')
		if (isInlineConversation) {
			for (const match of matches) {
				ranges.push({
					from: lineFrom + match.index,
					to: lineFrom + match.index + match.prompt.length,
					role: match.role,
				})
			}
		}
		lineFrom += line.length + 1
	}
	return ranges
}

export function createContinuationText(text: string) {
	const trimmed = text.trimEnd()
	if (!trimmed) {
		return INLINE_GREETING
	}
	if (trimmed.endsWith(USER_PROMPT)) {
		return trimmed
	}
	return `${trimmed}${TURN_SEPARATOR}${USER_PROMPT}`
}

export function sanitizeContextText(text: string) {
	INLINE_HISTORY_COMMENT_RE.lastIndex = 0
	const withoutHistory = text.replace(
		INLINE_HISTORY_COMMENT_RE,
		(_match, encoded: string) => {
			const payload = decodePayload(encoded)
			return payload ? createHistoryContextSummary(payload) : '[果札对话历史]'
		},
	)
	return withoutHistory
		.split('\n')
		.map((line) => {
			const matches = getPromptMatches(line)
			const isInlineConversation =
				matches.some((match) => match.role === 'assistant') &&
				matches.some((match) => match.role === 'user')
			if (!isInlineConversation) {
				return line
			}
			const messages = parseInlineMessages(line)
			if (!messages.length) {
				return '[果札内联对话]'
			}
			return `[果札内联对话：${messages
				.slice(-4)
				.map(
					(message) =>
						`${message.role === 'assistant' ? '果札' : '用户'}：${message.text}`,
				)
				.join('；')}]`
		})
		.join('\n')
}

export function encodePayload(payload: InlineAIHistoryPayload) {
	const bytes = new TextEncoder().encode(JSON.stringify(payload))
	if (typeof window === 'undefined' && typeof Buffer !== 'undefined') {
		return Buffer.from(bytes).toString('base64')
	}
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return window.btoa(binary)
}

export function decodePayload(encoded: string) {
	try {
		const bytes =
			typeof window === 'undefined' && typeof Buffer !== 'undefined'
				? Buffer.from(encoded, 'base64')
				: (() => {
						const binary = window.atob(encoded)
						const result = new Uint8Array(binary.length)
						for (let index = 0; index < binary.length; index += 1) {
							result[index] = binary.charCodeAt(index)
						}
						return result
					})()
		const payload = JSON.parse(
			new TextDecoder().decode(bytes),
		) as InlineAIHistoryPayload
		if (
			payload &&
			payload.version === 1 &&
			typeof payload.text === 'string' &&
			Array.isArray(payload.messages)
		) {
			return payload
		}
	} catch (error) {
		logger.warn('Failed to decode inline AI history', error)
	}
	return undefined
}

export function findInlineHistoryRangeForDelete(
	docText: string,
	position: number,
	key: InlineHistoryDeleteKey,
) {
	INLINE_HISTORY_COMMENT_RE.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = INLINE_HISTORY_COMMENT_RE.exec(docText)) !== null) {
		const payload = decodePayload(match[1])
		if (!payload) {
			continue
		}
		const from = match.index
		const to = match.index + match[0].length
		const touchesRange =
			key === 'Backspace'
				? position === to || (position > from && position <= to)
				: position === from || (position >= from && position < to)
		if (touchesRange) {
			return { from, to }
		}
	}
	return undefined
}

function getFilePath(view: EditorView) {
	const owner = InlineAIService.instance?.plugin
	const activeView = owner?.app.workspace.getActiveViewOfType(MarkdownView)
	if (activeView?.contentEl.contains(view.dom)) {
		return activeView.file?.path
	}
	const leaves = owner?.app.workspace.getLeavesOfType('markdown') || []
	const leaf = leaves.find((item) => {
		const markdownView = item.view
		return (
			markdownView instanceof MarkdownView &&
			markdownView.contentEl.contains(view.dom)
		)
	})
	const markdownView = leaf?.view
	if (markdownView instanceof MarkdownView) {
		return markdownView.file?.path
	}
	return owner?.app.workspace.getActiveFile?.()?.path
}

function activeContext(
	view: EditorView,
	position: number,
	selectionOverride?: string,
) {
	const doc = view.state.doc
	const from = Math.max(0, position - 4000)
	const to = Math.min(doc.length, position + 4000)
	const selection =
		selectionOverride ??
		view.state.sliceDoc(
			view.state.selection.main.from,
			view.state.selection.main.to,
		)
	return {
		filePath: getFilePath(view),
		before: sanitizeContextText(doc.sliceString(from, position)),
		after: sanitizeContextText(doc.sliceString(position, to)),
		selection: sanitizeContextText(selection),
	}
}

class InlineStreamCursorWidget extends WidgetType {
	eq(other: WidgetType) {
		return other instanceof InlineStreamCursorWidget
	}

	toDOM() {
		const cursor = document.createElement('span')
		cursor.className = 'guozha-inline-ai-stream-cursor'
		cursor.textContent = '▌'
		return cursor
	}

	ignoreEvent() {
		return true
	}
}

class InlineHistoryDotWidget extends WidgetType {
	constructor(
		private readonly service: InlineAIService,
		private readonly payload: InlineAIHistoryPayload,
		private readonly from: number,
		private readonly to: number,
	) {
		super()
	}

	eq(other: WidgetType) {
		return (
			other instanceof InlineHistoryDotWidget &&
			other.payload.id === this.payload.id &&
			other.payload.updatedAt === this.payload.updatedAt &&
			other.from === this.from &&
			other.to === this.to
		)
	}

	toDOM(view: EditorView) {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'guozha-inline-ai-history-dot'
		button.textContent = '•'
		button.ariaLabel = '展开果札对话'
		const preview = createHistoryPreview(this.payload)
		button.title = preview ? `展开果札对话：${preview}` : '展开果札对话'
		button.addEventListener('click', (event) => {
			event.preventDefault()
			event.stopPropagation()
			this.service.showHistoryPopover(
				view,
				this.payload,
				this.from,
				this.to,
				button,
			)
		})
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Backspace' && event.key !== 'Delete') {
				return
			}
			event.preventDefault()
			event.stopPropagation()
			this.service.deleteHistory(view, this.from, this.to)
		})
		return button
	}

	ignoreEvent() {
		return false
	}
}

class InlineAIViewPlugin {
	decorations: DecorationSet
	private activeResponse?: InlineAIActiveResponse
	private cancelledResponseIds = new Set<string>()
	private pendingPaints = new Map<string, number>()
	private pendingTriggerSelection?: { slashFrom: number; text: string }
	private inlineSelection?: { segmentStart: number; text: string }
	private historyPopover?: HTMLElement
	private historyPopoverCleanup?: () => void

	constructor(
		private readonly view: EditorView,
		private readonly plugin: NutstorePlugin,
		private readonly service: InlineAIService,
	) {
		this.decorations = this.buildDecorations()
	}

	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged) {
			this.closeHistoryPopover()
		}
		if (this.activeResponse && update.docChanged) {
			this.activeResponse = {
				...this.activeResponse,
				contextPosition: update.changes.mapPos(
					this.activeResponse.contextPosition,
				),
				responseStart: update.changes.mapPos(this.activeResponse.responseStart),
				responseEnd: update.changes.mapPos(this.activeResponse.responseEnd),
			}
		}
		if (update.docChanged || update.viewportChanged) {
			this.decorations = this.buildDecorations()
		}
	}

	destroy() {
		this.closeHistoryPopover()
	}

	handleKeydown(event: KeyboardEvent, view: EditorView) {
		if (event.defaultPrevented) {
			return false
		}
		if (this.pendingTriggerSelection && event.key !== '/') {
			this.pendingTriggerSelection = undefined
		}
		if (this.activeResponse) {
			if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				this.cancelActiveResponse()
				return true
			}
			if (event.key === 'Enter') {
				event.preventDefault()
				event.stopPropagation()
				return true
			}
		}
		if (
			(event.key === 'Backspace' || event.key === 'Delete') &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey
		) {
			return this.tryDeleteInlineHistory(event, view)
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			return this.trySubmitInlinePrompt(event, view)
		}
		if (event.key === '/') {
			return this.tryHandleDoubleSlash(event, view)
		}
		return false
	}

	expandHistory(payload: InlineAIHistoryPayload, from: number, to: number) {
		this.closeHistoryPopover()
		this.view.dispatch({
			changes: { from, to, insert: payload.text },
			selection: { anchor: from + payload.text.length },
			effects: EditorView.scrollIntoView(from + payload.text.length),
		})
		this.decorations = this.buildDecorations()
	}

	continueHistory(payload: InlineAIHistoryPayload, from: number, to: number) {
		this.closeHistoryPopover()
		const text = createContinuationText(payload.text)
		this.view.dispatch({
			changes: { from, to, insert: text },
			selection: { anchor: from + text.length },
			effects: EditorView.scrollIntoView(from + text.length),
		})
		this.decorations = this.buildDecorations()
	}

	deleteHistory(from: number, to: number) {
		this.deleteHistoryRange(from, to)
	}

	showHistoryPopover(
		payload: InlineAIHistoryPayload,
		from: number,
		to: number,
		anchor: HTMLElement,
	) {
		this.closeHistoryPopover()
		const popover = document.createElement('div')
		popover.className = 'guozha-inline-ai-history-popover'
		popover.setAttribute('role', 'dialog')
		popover.setAttribute('aria-label', '果札对话历史')

		const header = popover.createDiv({
			cls: 'guozha-inline-ai-history-popover-header',
		})
		header.createSpan({
			cls: 'guozha-inline-ai-history-popover-title',
			text: '果札对话',
		})
		const closeButton = header.createEl('button', {
			cls: 'guozha-inline-ai-history-popover-icon',
			text: '×',
			attr: { type: 'button', 'aria-label': '关闭' },
		})
		closeButton.addEventListener('click', () => this.closeHistoryPopover())

		const body = popover.createDiv({
			cls: 'guozha-inline-ai-history-popover-body',
		})
		for (const message of payload.messages) {
			const row = body.createDiv({
				cls: `guozha-inline-ai-history-popover-row guozha-inline-ai-history-popover-row-${message.role}`,
			})
			row.createSpan({
				cls: 'guozha-inline-ai-history-popover-speaker',
				text: message.role === 'assistant' ? ASSISTANT_PROMPT : USER_PROMPT,
			})
			row.createSpan({
				cls: 'guozha-inline-ai-history-popover-text',
				text: message.text,
			})
		}
		if (!payload.messages.length) {
			body.createDiv({
				cls: 'guozha-inline-ai-history-popover-empty',
				text: payload.text || '没有可显示的历史。',
			})
		}

		const footer = popover.createDiv({
			cls: 'guozha-inline-ai-history-popover-footer',
		})
		const continueButton = footer.createEl('button', {
			cls: 'guozha-inline-ai-history-popover-action guozha-inline-ai-history-popover-action-primary',
			text: '继续对话',
			attr: { type: 'button' },
		})
		continueButton.addEventListener('click', () =>
			this.continueHistory(payload, from, to),
		)
		const expandButton = footer.createEl('button', {
			cls: 'guozha-inline-ai-history-popover-action',
			text: '展开到文中',
			attr: { type: 'button' },
		})
		expandButton.addEventListener('click', () =>
			this.expandHistory(payload, from, to),
		)
		const copyButton = footer.createEl('button', {
			cls: 'guozha-inline-ai-history-popover-action',
			text: '复制历史',
			attr: { type: 'button' },
		})
		copyButton.addEventListener('click', async () => {
			try {
				if (!navigator.clipboard) {
					throw new Error('Clipboard unavailable')
				}
				await navigator.clipboard.writeText(payload.text)
				copyButton.textContent = '已复制'
			} catch (error) {
				logger.warn('Failed to copy inline AI history', error)
				copyButton.textContent = '复制失败'
			}
			window.setTimeout(() => {
				copyButton.textContent = '复制历史'
			}, 1200)
		})
		const deleteButton = footer.createEl('button', {
			cls: 'guozha-inline-ai-history-popover-action guozha-inline-ai-history-popover-action-danger',
			text: '删除记录',
			attr: { type: 'button' },
		})
		deleteButton.addEventListener('click', () => {
			this.deleteHistoryRange(from, to)
		})

		document.body.appendChild(popover)
		this.historyPopover = popover
		this.positionHistoryPopover(popover, anchor)

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target
			if (
				target instanceof Node &&
				!popover.contains(target) &&
				!anchor.contains(target)
			) {
				this.closeHistoryPopover()
			}
		}
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				this.closeHistoryPopover()
			}
		}
		const handleReposition = () => this.positionHistoryPopover(popover, anchor)
		window.addEventListener('pointerdown', handlePointerDown, true)
		window.addEventListener('keydown', handleKeydown, true)
		window.addEventListener('resize', handleReposition)
		window.addEventListener('scroll', handleReposition, true)
		this.historyPopoverCleanup = () => {
			window.removeEventListener('pointerdown', handlePointerDown, true)
			window.removeEventListener('keydown', handleKeydown, true)
			window.removeEventListener('resize', handleReposition)
			window.removeEventListener('scroll', handleReposition, true)
		}
	}

	private positionHistoryPopover(popover: HTMLElement, anchor: HTMLElement) {
		const anchorRect = anchor.getBoundingClientRect()
		const maxWidth = Math.min(420, window.innerWidth - 24)
		popover.style.maxWidth = `${maxWidth}px`
		popover.style.width = `${Math.min(maxWidth, 360)}px`
		const rect = popover.getBoundingClientRect()
		const left = Math.min(
			Math.max(12, anchorRect.left),
			window.innerWidth - rect.width - 12,
		)
		const below = anchorRect.bottom + 8
		const above = anchorRect.top - rect.height - 8
		const top =
			below + rect.height <= window.innerHeight - 12
				? below
				: Math.max(12, above)
		popover.style.left = `${left}px`
		popover.style.top = `${top}px`
	}

	private closeHistoryPopover() {
		this.historyPopoverCleanup?.()
		this.historyPopoverCleanup = undefined
		this.historyPopover?.remove()
		this.historyPopover = undefined
	}

	private tryDeleteInlineHistory(event: KeyboardEvent, view: EditorView) {
		const selection = view.state.selection.main
		if (!selection.empty) {
			return false
		}
		const range = findInlineHistoryRangeForDelete(
			view.state.doc.toString(),
			selection.head,
			event.key as InlineHistoryDeleteKey,
		)
		if (!range) {
			return false
		}
		event.preventDefault()
		event.stopPropagation()
		this.deleteHistoryRange(range.from, range.to)
		return true
	}

	private deleteHistoryRange(from: number, to: number) {
		this.closeHistoryPopover()
		this.view.dispatch({
			changes: { from, to, insert: '' },
			selection: { anchor: from },
			effects: EditorView.scrollIntoView(from),
		})
		this.decorations = this.buildDecorations()
	}

	private tryHandleDoubleSlash(event: KeyboardEvent, view: EditorView) {
		const selection = view.state.selection.main
		if (!selection.empty) {
			const text = view.state.sliceDoc(selection.from, selection.to)
			if (!text.trim()) {
				return false
			}
			const insertAt = selection.to
			event.preventDefault()
			event.stopPropagation()
			view.dispatch({
				changes: { from: insertAt, to: insertAt, insert: '/' },
				selection: { anchor: insertAt + 1 },
				effects: EditorView.scrollIntoView(insertAt + 1),
			})
			this.pendingTriggerSelection = { slashFrom: insertAt, text }
			return true
		}
		const head = selection.empty ? selection.head : selection.to
		const line = view.state.doc.lineAt(head)
		const textBeforeCursor = view.state.doc.sliceString(line.from, head)
		if (!textBeforeCursor.endsWith('/')) {
			return false
		}
		const charBeforeSlash =
			textBeforeCursor.length > 1
				? textBeforeCursor.charAt(textBeforeCursor.length - 2)
				: ''
		if (charBeforeSlash === ':' || charBeforeSlash === '/') {
			return false
		}

		const slashFrom = head - 1
		const slashOffset = slashFrom - line.from
		const segmentStart = findSegmentStart(line.text, slashOffset)
		const pendingSelection =
			this.pendingTriggerSelection?.slashFrom === slashFrom
				? this.pendingTriggerSelection
				: undefined
		this.pendingTriggerSelection = undefined
		event.preventDefault()
		event.stopPropagation()
		if (segmentStart !== undefined) {
			return this.collapseInlineConversation(line.from, segmentStart, slashFrom)
		}

		view.dispatch({
			changes: { from: slashFrom, to: head, insert: INLINE_GREETING },
			selection: { anchor: slashFrom + INLINE_GREETING.length },
			effects: EditorView.scrollIntoView(slashFrom + INLINE_GREETING.length),
		})
		this.inlineSelection = pendingSelection
			? { segmentStart: slashFrom, text: pendingSelection.text }
			: undefined
		this.decorations = this.buildDecorations()
		return true
	}

	private collapseInlineConversation(
		lineFrom: number,
		segmentStartOffset: number,
		slashFrom: number,
	) {
		const from = lineFrom + segmentStartOffset
		const text = this.view.state.doc.sliceString(from, slashFrom).trimEnd()
		if (!text) {
			return true
		}
		const payload: InlineAIHistoryPayload = {
			version: 1,
			id: createInlineId(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
			text,
			messages: parseInlineMessages(text),
		}
		const encoded = encodePayload(payload)
		const comment = `<!-- ${INLINE_HISTORY_COMMENT_PREFIX}${encoded} -->`
		this.view.dispatch({
			changes: { from, to: slashFrom + 1, insert: comment },
			selection: { anchor: from + comment.length },
			effects: EditorView.scrollIntoView(from),
		})
		this.inlineSelection = undefined
		this.decorations = this.buildDecorations()
		return true
	}

	private trySubmitInlinePrompt(event: KeyboardEvent, view: EditorView) {
		const selection = view.state.selection.main
		if (!selection.empty) {
			return false
		}
		const line = view.state.doc.lineAt(selection.head)
		const offset = selection.head - line.from
		const lastPrompt = findLastPromptBefore(line.text, offset)
		if (!lastPrompt || lastPrompt.prompt !== USER_PROMPT) {
			return false
		}
		event.preventDefault()
		event.stopPropagation()

		const input = line.text
			.slice(lastPrompt.index + USER_PROMPT.length, offset)
			.trim()
		if (!input) {
			return true
		}
		this.submitInlinePrompt(line.from, selection.head, input)
		return true
	}

	private submitInlinePrompt(
		lineFrom: number,
		insertAt: number,
		input: string,
	) {
		const line = this.view.state.doc.lineAt(insertAt)
		const offset = insertAt - line.from
		const segmentStart = findSegmentStart(line.text, offset) ?? 0
		const segmentText = line.text.slice(segmentStart, offset)
		const messages = parseInlineMessages(segmentText)
		if (!messages.some((message) => message.role === 'user')) {
			messages.push({
				role: 'user',
				text: input,
				createdAt: Date.now(),
			})
		}

		const insert = `${TURN_SEPARATOR}${ASSISTANT_PROMPT}`
		const responseStart = insertAt + insert.length
		const id = createInlineId()
		const inlineOptions = this.plugin.chatService.getInlineTextAIOptions(
			shouldUseToolsForInline(input),
		)
		const useTools = inlineOptions.useTools
		const absoluteSegmentStart = lineFrom + segmentStart
		const selectionText =
			this.inlineSelection?.segmentStart === absoluteSegmentStart
				? this.inlineSelection.text
				: undefined
		const activeResponse = {
			id,
			contextPosition: absoluteSegmentStart,
			messages,
			useTools,
			selectionText,
			responseStart,
			responseEnd: responseStart,
			lastPaintedAt: 0,
		}
		this.view.dispatch({
			changes: { from: insertAt, to: insertAt, insert },
			selection: { anchor: responseStart },
			effects: EditorView.scrollIntoView(responseStart),
		})
		this.activeResponse = activeResponse
		this.decorations = this.buildDecorations()
		void this.streamResponse(id)
	}

	private async streamResponse(id: string) {
		try {
			const active = this.activeResponse
			if (!active || active.id !== id) {
				return
			}
			const inlineOptions = this.plugin.chatService.getInlineTextAIOptions(
				active.useTools,
			)
			if (!inlineOptions.enabled) {
				this.replaceResponse(id, '文本 AI 已在设置中关闭。')
				this.finishResponse(id)
				return
			}
			let streamed = ''
			const reply = await this.plugin.chatService.runInlineAI({
				messages: active.messages,
				context: activeContext(
					this.view,
					active.contextPosition,
					active.selectionText,
				),
				allowLongForm: active.useTools,
				disableTools: !active.useTools,
				inferenceParams: inlineOptions.inferenceParams,
				modelSelection: inlineOptions.modelSelection,
				keepInlineAfterFileWrite: inlineOptions.keepInlineAfterFileWrite,
				onTextDelta: (_delta, fullText) => {
					streamed = normalizeInlineReply(fullText)
					this.replaceResponse(id, streamed, true)
				},
			})
			const finalText = normalizeInlineReply(reply.text || streamed)
			if (!reply.fileWritten) {
				this.replaceResponse(
					id,
					finalText || '我在，但这次没有生成可显示的内容。',
				)
			}
			this.finishResponse(id, { skipContinuation: reply.fileWritten })
		} catch (error) {
			logger.error(error)
			this.replaceResponse(id, `出错：${getErrorMessage(error)}`)
			this.finishResponse(id)
		}
	}

	private replaceResponse(id: string, text: string, throttled = false) {
		const active = this.activeResponse
		if (!active || active.id !== id || this.cancelledResponseIds.has(id)) {
			return
		}
		const now = Date.now()
		if (
			throttled &&
			text.length > 0 &&
			active.responseEnd > active.responseStart &&
			now - active.lastPaintedAt < 30
		) {
			this.clearPendingPaint(id)
			const timer = window.setTimeout(() => {
				this.pendingPaints.delete(id)
				const latest = this.activeResponse
				if (latest && latest.id === id && !this.cancelledResponseIds.has(id)) {
					this.replaceResponse(id, text)
				}
			}, 30)
			this.pendingPaints.set(id, timer)
			return
		}
		this.clearPendingPaint(id)
		const responseEnd = active.responseStart + text.length
		this.view.dispatch({
			changes: {
				from: active.responseStart,
				to: active.responseEnd,
				insert: text,
			},
			selection: { anchor: responseEnd },
		})
		this.activeResponse = {
			...active,
			responseEnd,
			lastPaintedAt: now,
		}
		this.decorations = this.buildDecorations()
		this.view.requestMeasure()
	}

	private finishResponse(
		id: string,
		options: { skipContinuation?: boolean } = {},
	) {
		const active = this.activeResponse
		if (!active || active.id !== id || this.cancelledResponseIds.has(id)) {
			return
		}
		this.clearPendingPaint(id)
		if (options.skipContinuation) {
			this.activeResponse = undefined
			this.inlineSelection = undefined
			this.decorations = this.buildDecorations()
			this.view.requestMeasure()
			return
		}
		const insert = `${TURN_SEPARATOR}${USER_PROMPT}`
		const nextPromptEnd = active.responseEnd + insert.length
		this.activeResponse = undefined
		this.inlineSelection = undefined
		this.view.dispatch({
			changes: { from: active.responseEnd, to: active.responseEnd, insert },
			selection: { anchor: nextPromptEnd },
			effects: EditorView.scrollIntoView(nextPromptEnd),
		})
		this.decorations = this.buildDecorations()
	}

	private cancelActiveResponse() {
		const active = this.activeResponse
		if (!active) {
			return
		}
		this.cancelledResponseIds.add(active.id)
		this.clearPendingPaint(active.id)
		const insert = `${TURN_SEPARATOR}${USER_PROMPT}`
		const nextPromptEnd = active.responseEnd + insert.length
		this.activeResponse = undefined
		this.inlineSelection = undefined
		this.view.dispatch({
			changes: { from: active.responseEnd, to: active.responseEnd, insert },
			selection: { anchor: nextPromptEnd },
		})
		this.decorations = this.buildDecorations()
	}

	private clearPendingPaint(id: string) {
		const timer = this.pendingPaints.get(id)
		if (timer !== undefined) {
			window.clearTimeout(timer)
			this.pendingPaints.delete(id)
		}
	}

	private buildDecorations() {
		const decorations: InlineAIDecoration[] = []
		const docText = this.view.state.doc.toString()

		let historyMatch: RegExpExecArray | null
		INLINE_HISTORY_COMMENT_RE.lastIndex = 0
		while ((historyMatch = INLINE_HISTORY_COMMENT_RE.exec(docText)) !== null) {
			const payload = decodePayload(historyMatch[1])
			if (!payload) {
				continue
			}
			decorations.push({
				from: historyMatch.index,
				to: historyMatch.index + historyMatch[0].length,
				value: Decoration.replace({
					widget: new InlineHistoryDotWidget(
						this.service,
						payload,
						historyMatch.index,
						historyMatch.index + historyMatch[0].length,
					),
					inclusive: false,
				}),
			})
		}

		for (const promptRange of getInlinePromptRanges(docText)) {
			decorations.push({
				from: promptRange.from,
				to: promptRange.to,
				value: Decoration.mark({
					class: `guozha-inline-ai-prompt guozha-inline-ai-prompt-${promptRange.role}`,
				}),
			})
		}

		if (this.activeResponse) {
			decorations.push({
				from: this.activeResponse.responseEnd,
				to: this.activeResponse.responseEnd,
				value: Decoration.widget({
					widget: new InlineStreamCursorWidget(),
					side: 1,
				}),
			})
		}
		decorations.sort(
			(left, right) =>
				left.from - right.from ||
				left.to - right.to ||
				(left.value.spec?.side || 0) - (right.value.spec?.side || 0),
		)
		const builder = new RangeSetBuilder<Decoration>()
		for (const decoration of decorations) {
			builder.add(decoration.from, decoration.to, decoration.value)
		}
		return builder.finish()
	}
}

export default class InlineAIService {
	static instance?: InlineAIService

	private extension = ViewPlugin.define(
		(view) => new InlineAIViewPlugin(view, this.plugin, this),
		{
			decorations: (value) => value.decorations,
			eventHandlers: {
				keydown(
					this: InlineAIViewPlugin,
					event: KeyboardEvent,
					view: EditorView,
				) {
					return this.handleKeydown(event, view)
				},
			},
		},
	)

	constructor(readonly plugin: NutstorePlugin) {
		InlineAIService.instance = this
	}

	load() {
		this.plugin.registerEditorExtension(Prec.high(this.extension))
	}

	expandHistory(
		view: EditorView,
		payload: InlineAIHistoryPayload,
		from: number,
		to: number,
	) {
		const pluginValue = view.plugin(this.extension)
		pluginValue?.expandHistory(payload, from, to)
	}

	continueHistory(
		view: EditorView,
		payload: InlineAIHistoryPayload,
		from: number,
		to: number,
	) {
		const pluginValue = view.plugin(this.extension)
		pluginValue?.continueHistory(payload, from, to)
	}

	deleteHistory(view: EditorView, from: number, to: number) {
		const pluginValue = view.plugin(this.extension)
		pluginValue?.deleteHistory(from, to)
	}

	showHistoryPopover(
		view: EditorView,
		payload: InlineAIHistoryPayload,
		from: number,
		to: number,
		anchor: HTMLElement,
	) {
		const pluginValue = view.plugin(this.extension)
		pluginValue?.showHistoryPopover(payload, from, to, anchor)
	}
}