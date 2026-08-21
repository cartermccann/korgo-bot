import { host } from '@hermes/plugin-sdk'

let lastConnectorSyncKey = ''

function rosterNamesForConnectors(roster) {
  const names = new Set(['default'])

  for (const bot of roster || []) {
    if (bot?.name) {
      names.add(bot.name)
    }
  }

  return [...names]
}

export function syncConnectorsForRoster(roster, { force = false } = {}) {
  const names = rosterNamesForConnectors(roster)
  const key = names.slice().sort().join(',')

  if (!force && key === lastConnectorSyncKey) {
    return
  }

  lastConnectorSyncKey = key
  const syncs = []

  if (typeof host.connectors?.syncProfiles === 'function') {
    syncs.push(host.connectors.syncProfiles(names))
  }

  if (typeof host.orgo?.syncProfiles === 'function') {
    syncs.push(host.orgo.syncProfiles(names))
  }

  if (syncs.length > 0) {
    Promise.allSettled(syncs).then(results => {
      const hasSuccessfulSync = results.some(result => result.status === 'fulfilled')

      if (results.some(result => result.status === 'rejected') && lastConnectorSyncKey === key) {
        // A transient backend/Orgo failure must not permanently suppress the
        // next roster-poll retry for these profiles.
        lastConnectorSyncKey = ''
      }

      if (!hasSuccessfulSync) {
        return
      }

      const sessionId = host.state.activeSessionId?.get?.() || null

      return host
        .request('reload.mcp', {
          confirm: true,
          ...(sessionId ? { session_id: sessionId } : {})
        })
        .catch(() => undefined)
    })
  }
}
