import { CHATBOX_VIEW_TYPE } from '~/views/chatbox.view'
import type NutstorePlugin from '..'

export async function openChatboxLeaf(plugin: NutstorePlugin) {
	const workspace = plugin.app.workspace
	const leaf =
		workspace.getLeavesOfType(CHATBOX_VIEW_TYPE)[0] ||
		workspace.getRightLeaf(false)
	if (!leaf) {
		return
	}

	await leaf.setViewState({ type: CHATBOX_VIEW_TYPE, active: true })
	workspace.setActiveLeaf(leaf, { focus: true })
}