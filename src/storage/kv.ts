import type { ChatSession, ChatSessionIndexItem } from '~/chat/domain'
import { StatModel } from '~/model/stat.model'
import { SyncRecordModel } from '~/model/sync-record.model'
import { IndexedDBStorage } from './indexeddb-storage'
import useStorage from './use-storage'

const DB_NAME = 'Nutstore_Plugin_Cache'
const STORE_NAMES = [
	'sync_record',
	'base_blob_store',
	'traverse_webdav_cache',
	'chat_sessions',
	'chat_meta',
]

function createStorage<T>(storeName: string) {
	return new IndexedDBStorage<T>({
		name: DB_NAME,
		storeName,
		storeNames: STORE_NAMES,
	})
}

export const syncRecordKV = useStorage<Map<string, SyncRecordModel>>(
	createStorage('sync_record'),
)

export const blobKV = useStorage<Blob>(createStorage('base_blob_store'))

export interface TraverseWebDAVCache {
	rootCursor: string
	queue: string[]
	nodes: Record<string, StatModel[]>
}

export const traverseWebDAVKV = useStorage<TraverseWebDAVCache>(
	createStorage('traverse_webdav_cache'),
)

export interface ChatMetaRecord {
	activeSessionId?: string
	orderedSessionIds: string[]
}

export const chatSessionKV = useStorage<ChatSession>(
	createStorage('chat_sessions'),
)

export const chatMetaKV = useStorage<ChatMetaRecord | ChatSessionIndexItem[]>(
	createStorage('chat_meta'),
)