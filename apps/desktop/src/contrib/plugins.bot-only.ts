import { createPluginContext } from '@desktop/plugin-context'

import botPlugin from '@/plugins/hermes-bots/plugin'

let loaded = false

export function discoverBundledPlugins(): void {
  if (loaded) {
    return
  }

  loaded = true
  const disposers: (() => void)[] = []
  botPlugin.register(createPluginContext(botPlugin.id, dispose => disposers.push(dispose)))
}
