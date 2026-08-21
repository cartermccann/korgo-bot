import type { WebContents } from 'electron'

export function registerMiniDesktopProxy(_options: unknown): { disposeOwner: (owner: WebContents) => void } {
  return { disposeOwner: (_owner: WebContents) => {} }
}
