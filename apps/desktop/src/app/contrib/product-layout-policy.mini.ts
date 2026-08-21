import type { LayoutNode } from '@/components/pane-shell/tree/model'

// The Mini SKU restores the Bot roster and shared-computer rail while keeping
// every Kronos-local pane (filesystem, Git review, and terminal) absent.
export const CORE_SESSIONS_PANE_ALLOWED = false
export const LOCAL_CORE_PANES_ALLOWED = false
export const SINGLE_LAYOUT_ONLY = true
export const STATUSBAR_CHROME_ALLOWED = false
export const BOT_ROSTER_PANE_ID = 'hermes-bots:pane-v2'

export function selectProductTree(trees: { bot: LayoutNode; ssh: LayoutNode; standard: LayoutNode }): LayoutNode {
  return trees.bot
}
