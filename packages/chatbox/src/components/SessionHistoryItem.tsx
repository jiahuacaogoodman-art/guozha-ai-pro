import { Show, createSignal } from 'solid-js'
import type { ChatboxProps } from '../types'
import { t } from '../i18n'
import { formatTime } from '../utils'

export function SessionHistoryItem(props: {
	session: ChatboxProps['sessionHistory'][number]
	isActive: boolean
	onSelect: (sessionId: string) => void
	onDelete: (sessionId: string) => void
	onRename?: (sessionId: string, title: string) => Promise<void> | void
}) {
	const [isRenaming, setIsRenaming] = createSignal(false)
	const [draftTitle, setDraftTitle] = createSignal(props.session.title)
	const activate = () => props.onSelect(props.session.id)
	const beginRename = () => {
		setDraftTitle(props.session.title)
		setIsRenaming(true)
	}
	const saveRename = () => {
		const nextTitle = draftTitle().trim()
		if (!nextTitle) {
			setDraftTitle(props.session.title)
			setIsRenaming(false)
			return
		}
		void props.onRename?.(props.session.id, nextTitle)
		setIsRenaming(false)
	}

	return (
		<div
			role="button"
			tabIndex={0}
			class={`group relative w-full overflow-hidden rounded-3 border px-3 py-3 text-left transition-colors ${
				props.isActive
					? 'border-[var(--interactive-accent)] bg-[var(--background-secondary)]'
					: 'border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] hover:bg-[var(--background-modifier-hover)]'
			}`}
			onClick={() => {
				if (!isRenaming()) {
					activate()
				}
			}}
			onKeyDown={(event) => {
				if (isRenaming()) {
					return
				}
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault()
					activate()
				}
			}}
		>
			<Show when={props.isActive}>
				<div class="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--interactive-accent)]" />
			</Show>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0 flex-1">
					<Show
						when={isRenaming()}
						fallback={
							<div class="truncate pr-1 text-sm font-medium text-[var(--text-normal)]">
								{props.session.title}
							</div>
						}
					>
						<input
							class="w-full rounded-2 border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-sm text-[var(--text-normal)] outline-none"
							value={draftTitle()}
							aria-label={t('renameSession')}
							onClick={(event) => event.stopPropagation()}
							onInput={(event) => setDraftTitle(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault()
									event.stopPropagation()
									saveRename()
								}
								if (event.key === 'Escape') {
									event.preventDefault()
									event.stopPropagation()
									setDraftTitle(props.session.title)
									setIsRenaming(false)
								}
							}}
						/>
					</Show>
					<div class="mt-2 text-xs text-[var(--text-muted)]">
						{formatTime(props.session.createdAt)}
					</div>
				</div>
				<div class="flex shrink-0 items-center gap-1">
					<Show when={props.onRename}>
						<button
							class="rounded-2 border border-[var(--background-modifier-border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]"
							type="button"
							aria-label={isRenaming() ? t('saveRename') : t('renameSession')}
							onClick={(event) => {
								event.preventDefault()
								event.stopPropagation()
								if (isRenaming()) {
									saveRename()
								} else {
									beginRename()
								}
							}}
						>
							{isRenaming() ? t('saveRename') : t('renameSession')}
						</button>
					</Show>
					<button
						class="rounded-2 border border-[var(--background-modifier-border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-error)]"
						type="button"
						aria-label={t('deleteSession')}
						onClick={(event) => {
							event.preventDefault()
							event.stopPropagation()
							props.onDelete(props.session.id)
						}}
					>
						{t('deleteSession')}
					</button>
				</div>
			</div>
		</div>
	)
}