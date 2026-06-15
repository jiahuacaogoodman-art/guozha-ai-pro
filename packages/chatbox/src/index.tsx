import './assets/styles/global.css'

import { createStore, reconcile } from 'solid-js/store'
import { render } from 'solid-js/web'
import App, { AppProps } from './App'
export * from './types'

export interface ChatboxController {
	update: (props: AppProps) => void
	destroy: () => void
}

export function mount(el: Element, props: AppProps): ChatboxController {
	let update = (_props: AppProps) => {}
	const initialProps = {
		...props,
		activeDocument: props.activeDocument ?? el.ownerDocument,
	}
	const destroy = render(() => {
		const [state, setState] = createStore(initialProps)
		update = (nextProps: AppProps) => {
			setState(
				reconcile({
					...nextProps,
					activeDocument: nextProps.activeDocument ?? el.ownerDocument,
				}),
			)
		}
		return <App {...state} />
	}, el)

	return {
		update,
		destroy,
	}
}