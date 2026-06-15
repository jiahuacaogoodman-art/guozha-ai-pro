import { StorageInterface } from './use-storage'

interface IndexedDBStorageOptions {
	name: string
	storeName: string
	storeNames: string[]
}

const databases = new Map<string, Promise<IDBDatabase>>()

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () =>
			reject(request.error ?? new Error('IndexedDB request failed'))
	})
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onabort = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
		transaction.onerror = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction failed'))
	})
}

function hasStores(db: IDBDatabase, storeNames: string[]) {
	return storeNames.every((storeName) =>
		db.objectStoreNames.contains(storeName),
	)
}

function createMissingStores(db: IDBDatabase, storeNames: string[]) {
	for (const storeName of storeNames) {
		if (!db.objectStoreNames.contains(storeName)) {
			db.createObjectStore(storeName)
		}
	}
}

function openDatabase(
	name: string,
	storeNames: string[],
	version?: number,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request =
			version === undefined
				? indexedDB.open(name)
				: indexedDB.open(name, version)

		request.onupgradeneeded = () => {
			createMissingStores(request.result, storeNames)
		}
		request.onsuccess = () => {
			const db = request.result
			db.onversionchange = () => {
				db.close()
				databases.delete(name)
			}
			resolve(db)
		}
		request.onerror = () =>
			reject(request.error ?? new Error('IndexedDB open failed'))
		request.onblocked = () =>
			reject(new Error(`IndexedDB upgrade blocked for ${name}`))
	})
}

async function openDatabaseWithStores(
	name: string,
	storeNames: string[],
): Promise<IDBDatabase> {
	const db = await openDatabase(name, storeNames)
	if (hasStores(db, storeNames)) {
		return db
	}

	const nextVersion = db.version + 1
	db.close()
	return openDatabase(name, storeNames, nextVersion)
}

async function getDatabase(
	name: string,
	storeNames: string[],
): Promise<IDBDatabase> {
	const cached = databases.get(name)
	if (cached) {
		const db = await cached
		if (hasStores(db, storeNames)) {
			return db
		}
		db.close()
		databases.delete(name)
	}

	let promise: Promise<IDBDatabase>
	promise = openDatabaseWithStores(name, storeNames).catch((error) => {
		if (databases.get(name) === promise) {
			databases.delete(name)
		}
		throw error
	})
	databases.set(name, promise)
	return promise
}

export class IndexedDBStorage<T = any> extends StorageInterface<T> {
	constructor(private options: IndexedDBStorageOptions) {
		super()
	}

	private async transaction(mode: IDBTransactionMode) {
		const { name, storeName, storeNames } = this.options
		try {
			const db = await getDatabase(name, storeNames)
			return db.transaction(storeName, mode)
		} catch (error) {
			if (error instanceof DOMException && error.name === 'NotFoundError') {
				databases.delete(name)
				const db = await getDatabase(name, storeNames)
				return db.transaction(storeName, mode)
			}
			throw error
		}
	}

	async setItem(key: string, value: T): Promise<T> {
		const transaction = await this.transaction('readwrite')
		const done = transactionDone(transaction)
		transaction.objectStore(this.options.storeName).put(value, key)
		await done
		return value
	}

	async getItem(key: string): Promise<T | null> {
		const transaction = await this.transaction('readonly')
		const done = transactionDone(transaction)
		const result = await requestToPromise<T | undefined>(
			transaction.objectStore(this.options.storeName).get(key),
		)
		await done
		return result ?? null
	}

	async removeItem(key: string): Promise<void> {
		const transaction = await this.transaction('readwrite')
		const done = transactionDone(transaction)
		transaction.objectStore(this.options.storeName).delete(key)
		await done
	}

	async keys(): Promise<string[]> {
		const transaction = await this.transaction('readonly')
		const done = transactionDone(transaction)
		const keys = await requestToPromise<IDBValidKey[]>(
			transaction.objectStore(this.options.storeName).getAllKeys(),
		)
		await done
		return keys.map((key) => String(key))
	}

	async clear(): Promise<void> {
		const transaction = await this.transaction('readwrite')
		const done = transactionDone(transaction)
		transaction.objectStore(this.options.storeName).clear()
		await done
	}
}