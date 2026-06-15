export function isNil(value: unknown): value is null | undefined {
	return value === null || value === undefined
}

export function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

export function chunk<T>(items: T[], size: number): T[][] {
	if (size <= 0) {
		return [items]
	}
	const result: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		result.push(items.slice(index, index + size))
	}
	return result
}

export function cloneDeep<T>(value: T): T {
	if (typeof structuredClone === 'function') {
		return structuredClone(value)
	}
	return JSON.parse(JSON.stringify(value)) as T
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
	if (left.byteLength !== right.byteLength) {
		return false
	}
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) {
			return false
		}
	}
	return true
}

export function isEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true
	}
	if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
		return equalBytes(new Uint8Array(left), new Uint8Array(right))
	}
	if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) {
		return equalBytes(
			new Uint8Array(left.buffer, left.byteOffset, left.byteLength),
			new Uint8Array(right.buffer, right.byteOffset, right.byteLength),
		)
	}
	return JSON.stringify(left) === JSON.stringify(right)
}

type Debounced<TArgs extends unknown[]> = ((...args: TArgs) => void) & {
	cancel: () => void
	flush: () => void | Promise<void>
}

interface DebounceOptions {
	leading?: boolean
	trailing?: boolean
}

export function debounce<TArgs extends unknown[]>(
	fn: (...args: TArgs) => void | Promise<void>,
	wait: number,
	options: DebounceOptions = {},
): Debounced<TArgs> {
	let timer: number | undefined
	let pendingArgs: TArgs | undefined
	const invoke = () => {
		if (!pendingArgs) {
			return undefined
		}
		const args = pendingArgs
		pendingArgs = undefined
		return fn(...args)
	}
	const debounced = ((...args: TArgs) => {
		const shouldRunLeading = options.leading && timer === undefined
		const shouldRunTrailing = options.trailing !== false
		pendingArgs = args
		window.clearTimeout(timer)
		if (shouldRunLeading) {
			void invoke()
		}
		if (shouldRunTrailing) {
			timer = window.setTimeout(() => {
				timer = undefined
				void invoke()
			}, wait)
		} else {
			timer = undefined
		}
	}) as Debounced<TArgs>
	debounced.cancel = () => {
		window.clearTimeout(timer)
		timer = undefined
		pendingArgs = undefined
	}
	debounced.flush = () => {
		window.clearTimeout(timer)
		timer = undefined
		return invoke()
	}
	return debounced
}

export function throttle<TArgs extends unknown[]>(
	fn: (...args: TArgs) => void,
	wait: number,
): Debounced<TArgs> {
	let lastRun = 0
	let timer: number | undefined
	const throttled = ((...args: TArgs) => {
		const now = Date.now()
		const remaining = wait - (now - lastRun)
		if (remaining <= 0) {
			window.clearTimeout(timer)
			timer = undefined
			lastRun = now
			fn(...args)
			return
		}
		if (timer === undefined) {
			timer = window.setTimeout(() => {
				timer = undefined
				lastRun = Date.now()
				fn(...args)
			}, remaining)
		}
	}) as Debounced<TArgs>
	throttled.cancel = () => window.clearTimeout(timer)
	throttled.flush = () => undefined
	return throttled
}