import logger from './logger'

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(getErrorMessage(error))
}

export function runAsync(task: () => unknown): void {
	void Promise.resolve()
		.then(task)
		.catch((error) => logger.error(error))
}