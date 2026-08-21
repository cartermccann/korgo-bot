import type { IpcRenderer } from 'electron'

export function createSkuPreloadBridge(ipcRenderer: IpcRenderer) {
  const eventBridge = (channel: string, callback: (payload: any) => void) => {
    const listener = (_event: unknown, payload: any) => callback(payload)
    ipcRenderer.on(channel, listener)

    return () => ipcRenderer.removeListener(channel, listener)
  }

  return {
    gatewayProxy: {
      start: async request => {
        await ipcRenderer.invoke('hermes:gateway-proxy:start', request)
      },
      send: (id, data) => ipcRenderer.send('hermes:gateway-proxy:send', { data, id }),
      close: id => ipcRenderer.send('hermes:gateway-proxy:close', { id }),
      onEvent: callback => eventBridge('hermes:gateway-proxy:event', callback)
    },
    miniDesktop: {
      ack: (id, bytes) => ipcRenderer.send('hermes:mini-desktop:ack', { bytes, id }),
      start: async id => {
        await ipcRenderer.invoke('hermes:mini-desktop:start', { id })
      },
      send: (id, data) => ipcRenderer.send('hermes:mini-desktop:send', { data, id }),
      close: id => ipcRenderer.send('hermes:mini-desktop:close', { id }),
      onEvent: callback => eventBridge('hermes:mini-desktop:event', callback)
    }
  }
}
