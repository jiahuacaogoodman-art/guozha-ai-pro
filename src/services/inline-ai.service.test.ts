import { describe, expect, it } from 'vitest'
import {
	createContinuationText,
	decodePayload,
	encodePayload,
	findInlineHistoryRangeForDelete,
	getInlinePromptRanges,
	normalizeInlineReply,
	parseInlineMessages,
	sanitizeContextText,
	shouldUseToolsForInline,
} from './inline-ai.service'

describe('inline ai helpers', () => {
	it('parses inline turns while ignoring the initial greeting', () => {
		const messages = parseInlineMessages(
			'果札：你好。    你：解释近婚系数    果札：它是同祖基因概率。    你：再短一点',
		)

		expect(messages.map(({ role, text }) => ({ role, text }))).toEqual([
			{ role: 'user', text: '解释近婚系数' },
			{ role: 'assistant', text: '它是同祖基因概率。' },
			{ role: 'user', text: '再短一点' },
		])
	})

	it('uses tools for file and action requests but not plain explanations', () => {
		expect(shouldUseToolsForInline('帮我修复当前笔记里的错别字')).toBe(true)
		expect(shouldUseToolsForInline('我让你给我在文件里做表')).toBe(true)
		expect(shouldUseToolsForInline('给我在当前笔记里插入一个对比表格')).toBe(
			true,
		)
		expect(shouldUseToolsForInline('测试这个插件并告诉我结果')).toBe(true)
		expect(shouldUseToolsForInline('解释一下近婚系数是什么')).toBe(false)
		expect(shouldUseToolsForInline('给我讲讲为什么会这样')).toBe(false)
	})

	it('normalizes streamed inline text without forcing tool answers short', () => {
		expect(normalizeInlineReply('第一行\n\n第二行     第三行')).toBe(
			'第一行 第二行    第三行',
		)
	})

	it('round trips collapsed history payloads', () => {
		const payload = {
			version: 1 as const,
			id: 'inline-test',
			createdAt: 1,
			updatedAt: 2,
			text: '果札：你好。    你：改当前笔记    果札：已完成。',
			messages: [
				{ role: 'user' as const, text: '改当前笔记', createdAt: 1 },
				{ role: 'assistant' as const, text: '已完成。', createdAt: 2 },
			],
		}

		expect(decodePayload(encodePayload(payload))).toEqual(payload)
	})

	it('marks only real inline conversation prompt pairs', () => {
		const text = [
			'普通引用：你：这不是内联 AI',
			'果札：你好。    你：写一句话',
			'只有果札：也不是',
		].join('\n')

		expect(getInlinePromptRanges(text).map((range) => range.role)).toEqual([
			'assistant',
			'user',
		])
	})

	it('creates continuation text without duplicating the user prompt', () => {
		expect(createContinuationText('果札：你好。    你：')).toBe(
			'果札：你好。    你：',
		)
		expect(createContinuationText('果札：你好。    你：问    果札：答')).toBe(
			'果札：你好。    你：问    果札：答    你：',
		)
	})

	it('sanitizes hidden inline history before sending document context', () => {
		const payload = {
			version: 1 as const,
			id: 'inline-test',
			createdAt: 1,
			updatedAt: 2,
			text: '果札：你好。    你：改标题    果札：已把标题改短。',
			messages: [
				{ role: 'user' as const, text: '改标题', createdAt: 1 },
				{ role: 'assistant' as const, text: '已把标题改短。', createdAt: 2 },
			],
		}
		const encoded = encodePayload(payload)
		const sanitized = sanitizeContextText(
			`正文 <!-- guozha-inline-chat:${encoded} --> 后文`,
		)

		expect(sanitized).toContain(
			'正文 [果札对话历史：用户：改标题；果札：已把标题改短。] 后文',
		)
		expect(sanitized).not.toContain(encoded)
	})

	it('finds collapsed history ranges for direct keyboard deletion', () => {
		const payload = {
			version: 1 as const,
			id: 'inline-test',
			createdAt: 1,
			updatedAt: 2,
			text: '果札：你好。    你：删除测试',
			messages: [{ role: 'user' as const, text: '删除测试', createdAt: 1 }],
		}
		const comment = `<!-- guozha-inline-chat:${encodePayload(payload)} -->`
		const text = `前${comment}后`
		const from = 1
		const to = from + comment.length

		expect(findInlineHistoryRangeForDelete(text, to, 'Backspace')).toEqual({
			from,
			to,
		})
		expect(findInlineHistoryRangeForDelete(text, from, 'Delete')).toEqual({
			from,
			to,
		})
		expect(
			findInlineHistoryRangeForDelete(text, from - 1, 'Backspace'),
		).toBeUndefined()
		expect(
			findInlineHistoryRangeForDelete(text, to + 1, 'Delete'),
		).toBeUndefined()
	})

	it('summarizes real inline conversation rows without touching plain prose', () => {
		expect(
			sanitizeContextText(
				'普通引用：你：这不是内联 AI\n果札：你好。    你：解释一下    果札：可以。',
			),
		).toBe(
			'普通引用：你：这不是内联 AI\n[果札内联对话：用户：解释一下；果札：可以。]',
		)
	})
})