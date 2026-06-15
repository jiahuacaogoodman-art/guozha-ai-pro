import { createSignal, onCleanup } from 'solid-js'

interface PaneResizerProps {
	activeDocument: Document
	onResizeStart?: () => void
	onResize: (deltaY: number) => void
	onResizeEnd?: () => void
	onDblClick?: () => void
}

export function PaneResizer(props: PaneResizerProps) {
	const [isResizing, setIsResizing] = createSignal(false)
	let startY = 0
	let removeListeners: (() => void) | undefined
	let resizeDocument: Document | undefined

	function stopResize() {
		removeListeners?.()
		removeListeners = undefined
		setIsResizing(false)
		resizeDocument?.body.classList.remove('chatbox-resize-active')
		resizeDocument = undefined
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) {
			return
		}

		event.preventDefault()
		stopResize()
		props.onResizeStart?.()
		startY = event.clientY
		resizeDocument = props.activeDocument
		setIsResizing(true)
		resizeDocument.body.classList.add('chatbox-resize-active')

		const onPointerMove = (moveEvent: PointerEvent) => {
			props.onResize(startY - moveEvent.clientY)
		}

		const onPointerUp = () => {
			props.onResizeEnd?.()
			stopResize()
		}

		resizeDocument.addEventListener('pointermove', onPointerMove)
		resizeDocument.addEventListener('pointerup', onPointerUp)
		resizeDocument.addEventListener('pointercancel', onPointerUp)
		removeListeners = () => {
			resizeDocument?.removeEventListener('pointermove', onPointerMove)
			resizeDocument?.removeEventListener('pointerup', onPointerUp)
			resizeDocument?.removeEventListener('pointercancel', onPointerUp)
		}
	}

	onCleanup(() => stopResize())

	return (
		<div
			class="chatbox-resizer px-3"
			classList={{ 'is-resizing': isResizing() }}
			role="separator"
			aria-orientation="horizontal"
			onPointerDown={onPointerDown}
			onDblClick={() => props.onDblClick?.()}
		>
			<div class="chatbox-resizer-line" />
		</div>
	)
}