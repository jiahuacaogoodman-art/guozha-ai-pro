type ProcessLike = {
	cwd?: () => string
	env?: Record<string, string | undefined>
}

type RuntimeWindow = Window & {
	process?: ProcessLike
}

const runtimeWindow = window as RuntimeWindow

const processLike: ProcessLike = runtimeWindow.process ?? {
	cwd() {
		return '/'
	},
	env: {},
}

if (typeof processLike.cwd !== 'function') {
	processLike.cwd = () => '/'
}

if (!processLike.env || typeof processLike.env !== 'object') {
	processLike.env = {}
}

runtimeWindow.process = processLike

export {}