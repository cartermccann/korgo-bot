import { createPluginI18n } from '@/i18n'
import { readKey, writeKey } from '@/lib/storage'

import type { PluginContext, PluginContribution, PluginOs, PluginStorage } from './plugin'
import { registry } from './registry'
import type { Contribution } from './types'

function createPluginStorage(pluginId: string): PluginStorage {
  const scoped = (key: string) => `hermes.plugin.${pluginId}.${key}`

  return {
    get(key, fallback) {
      const raw = readKey(scoped(key))

      if (raw === null) {
        return fallback
      }

      try {
        return JSON.parse(raw)
      } catch {
        return fallback
      }
    },
    set: (key, value) => writeKey(scoped(key), JSON.stringify(value)),
    remove: key => writeKey(scoped(key), null)
  }
}

const MINI_OS: PluginOs = Object.freeze({
  notify: () => undefined,
  openExternal: async () => false,
  revealPath: async () => false,
  writeClipboard: async () => false
})

export function createPluginContext(pluginId: string, onDispose?: (dispose: () => void) => void): PluginContext {
  const source = `plugin:${pluginId}`

  const scope = (contribution: PluginContribution): Contribution => ({
    ...contribution,
    id: `${pluginId}:${contribution.id}`,
    source
  })

  const track = (dispose: () => void) => {
    onDispose?.(dispose)

    return dispose
  }

  return {
    source,
    register: contribution => track(registry.register(scope(contribution))),
    registerMany: contributions => track(registry.registerMany(contributions.map(scope))),
    onDispose: dispose => void track(dispose),
    rest: async () => {
      throw new Error('Plugin REST is unavailable in the Mini client.')
    },
    socket: () => () => undefined,
    os: MINI_OS,
    storage: createPluginStorage(pluginId),
    i18n: createPluginI18n(pluginId, track)
  }
}
