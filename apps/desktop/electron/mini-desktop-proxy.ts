import net from 'node:net'

import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'

const START_CHANNEL = 'hermes:mini-desktop:start'
const SEND_CHANNEL = 'hermes:mini-desktop:send'
const CLOSE_CHANNEL = 'hermes:mini-desktop:close'
const ACK_CHANNEL = 'hermes:mini-desktop:ack'
const EVENT_CHANNEL = 'hermes:mini-desktop:event'
const REMOTE_VNC_PORT = 5901
const MAX_FRAME_BYTES = 4 * 1024 * 1024
const MAX_INBOUND_OUTSTANDING_BYTES = 4 * 1024 * 1024
const INBOUND_RESUME_BYTES = MAX_INBOUND_OUTSTANDING_BYTES / 2
const ID_RE = /^[a-zA-Z0-9-]{8,128}$/

interface IpcRegistrar {
  handle: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => void
  on: (channel: string, listener: (event: IpcMainEvent, ...args: any[]) => unknown) => void
}

interface SshForwarder {
  exec: (command: string, options?: { timeoutMs?: number }) => Promise<unknown>
  forward: (localPort: number, remotePort: number, remoteHost?: string) => Promise<unknown>
  cancelForward: (localPort: number, remotePort: number, remoteHost?: string) => Promise<unknown>
  isAlive: () => Promise<boolean>
}

interface SocketLike {
  destroy: () => void
  on: (event: string, listener: (...args: any[]) => void) => SocketLike
  pause: () => unknown
  resume: () => unknown
  readonly writableLength?: number
  write: (data: Uint8Array) => unknown
}

interface Entry {
  id: string
  localPort: number
  owner: WebContents
  outstandingBytes: number
  paused: boolean
  socket: SocketLike
  ssh: SshForwarder
}

interface PendingStart {
  cancelled: boolean
  forwardAttempted: boolean
  forwardCancelled: boolean
  forwardTransferred: boolean
  id: string
  key: string
  localPort?: number
  owner: WebContents
  socket?: SocketLike
  ssh?: SshForwarder
}

export interface MiniDesktopProxyOptions {
  createConnection?: (options: { host: string; port: number }) => SocketLike
  ipc: IpcRegistrar
  pickLocalPort: () => Promise<number>
  resolveSsh: () => Promise<SshForwarder>
}

export function registerMiniDesktopProxy(options: MiniDesktopProxyOptions): {
  disposeOwner: (owner: WebContents) => void
} {
  const entries = new Map<string, Entry>()
  const pendingStarts = new Map<string, PendingStart>()
  const createConnection = options.createConnection ?? (connectionOptions => net.createConnection(connectionOptions))
  const entryKey = (owner: WebContents, id: string) => `${owner.id}:${id}`

  const emit = (entry: Entry, payload: Record<string, unknown>) => {
    if (entry.owner.isDestroyed()) {
      return false
    }

    try {
      entry.owner.send(EVENT_CHANNEL, payload)
    } catch {
      return false
    }

    return true
  }

  const closeEntry = async (key: string, reason = 'closed') => {
    const entry = entries.get(key)

    if (!entry) {
      return
    }

    entries.delete(key)
    entry.socket.destroy()

    try {
      await entry.ssh.cancelForward(entry.localPort, REMOTE_VNC_PORT, '127.0.0.1')
    } catch {
      // The shared ControlMaster may already have closed.
    }

    emit(entry, { id: entry.id, reason, type: 'close' })
  }

  const cancelPendingStart = (key: string) => {
    const pending = pendingStarts.get(key)

    if (pending) {
      pending.cancelled = true
    }
  }

  const assertPendingStart = (pending: PendingStart) => {
    if (pending.cancelled || pending.owner.isDestroyed() || pendingStarts.get(pending.key) !== pending) {
      pending.cancelled = true
      throw new Error('Mini desktop channel start cancelled.')
    }
  }

  const cleanupPendingStart = async (pending: PendingStart) => {
    pending.socket?.destroy()
    pending.socket = undefined

    if (
      pending.forwardAttempted &&
      !pending.forwardTransferred &&
      !pending.forwardCancelled &&
      pending.ssh &&
      pending.localPort !== undefined
    ) {
      pending.forwardCancelled = true

      try {
        await pending.ssh.cancelForward(pending.localPort, REMOTE_VNC_PORT, '127.0.0.1')
      } catch {
        // A rejected/partially opened forward or shared ControlMaster may already be gone.
      }
    }
  }

  options.ipc.handle(START_CHANNEL, async (event, raw) => {
    const id = String(raw?.id || '')

    if (!ID_RE.test(id)) {
      throw new Error('Invalid Mini desktop channel id.')
    }

    if (event.sender.isDestroyed()) {
      throw new Error('Mini desktop channel owner is unavailable.')
    }

    if (
      [...pendingStarts.values()].some(pending => pending.owner === event.sender) ||
      [...entries.values()].some(entry => entry.owner === event.sender)
    ) {
      throw new Error('A Mini desktop channel is already active for this window.')
    }

    const key = entryKey(event.sender, id)

    const pending: PendingStart = {
      cancelled: false,
      forwardAttempted: false,
      forwardCancelled: false,
      forwardTransferred: false,
      id,
      key,
      owner: event.sender
    }

    pendingStarts.set(key, pending)

    try {
      const ssh = await options.resolveSsh()
      pending.ssh = ssh
      assertPendingStart(pending)

      if (!(await ssh.isAlive())) {
        throw new Error('The Mini SSH connection is unavailable.')
      }

      assertPendingStart(pending)

      await ssh.exec('/usr/local/bin/korgo-workspace status', { timeoutMs: 10_000 })
      assertPendingStart(pending)

      const localPort = await options.pickLocalPort()
      pending.localPort = localPort
      assertPendingStart(pending)

      pending.forwardAttempted = true
      await ssh.forward(localPort, REMOTE_VNC_PORT, '127.0.0.1')
      assertPendingStart(pending)

      const socket = createConnection({ host: '127.0.0.1', port: localPort })
      pending.socket = socket
      assertPendingStart(pending)

      const entry: Entry = {
        id,
        localPort,
        outstandingBytes: 0,
        owner: event.sender,
        paused: false,
        socket,
        ssh
      }

      entries.set(key, entry)

      try {
        socket.on('connect', () => {
          if (!emit(entry, { id, type: 'open' })) {
            void closeEntry(key, 'renderer destroyed')
          }
        })
        socket.on('data', data => {
          if (entries.get(key) !== entry) {
            return
          }

          const frame = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

          if (
            frame.byteLength === 0 ||
            frame.byteLength > MAX_INBOUND_OUTSTANDING_BYTES ||
            entry.outstandingBytes + frame.byteLength > MAX_INBOUND_OUTSTANDING_BYTES
          ) {
            void closeEntry(key, 'Mini desktop inbound flow-control limit reached')

            return
          }

          entry.outstandingBytes += frame.byteLength

          if (!emit(entry, { data: frame, id, type: 'message' })) {
            void closeEntry(key, 'renderer destroyed')

            return
          }

          if (entry.outstandingBytes >= MAX_INBOUND_OUTSTANDING_BYTES && !entry.paused) {
            entry.paused = true
            socket.pause()
          }
        })
        socket.on('error', () => {
          emit(entry, { id, type: 'error' })
          void closeEntry(key, 'Mini desktop connection failed')
        })
        socket.on('close', () => void closeEntry(key, 'Mini desktop connection closed'))
      } catch (error) {
        entries.delete(key)
        throw error
      }

      pending.forwardTransferred = true
      pending.socket = undefined

      return { ok: true }
    } finally {
      await cleanupPendingStart(pending)
      pendingStarts.delete(key)
    }
  })

  options.ipc.on(SEND_CHANNEL, (event, raw) => {
    const id = String(raw?.id || '')
    const key = entryKey(event.sender, id)
    const entry = entries.get(key)

    if (!entry) {
      return
    }

    const rawData = raw?.data

    const data =
      rawData instanceof Uint8Array
        ? rawData
        : rawData instanceof ArrayBuffer
          ? new Uint8Array(rawData)
          : ArrayBuffer.isView(rawData)
            ? new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength)
            : null

    if (
      !data ||
      data.byteLength === 0 ||
      data.byteLength > MAX_FRAME_BYTES ||
      Number(entry.socket.writableLength || 0) + data.byteLength > MAX_FRAME_BYTES
    ) {
      void closeEntry(key, 'Mini desktop frame denied')

      return
    }

    if (entry.socket.write(data) === false) {
      void closeEntry(key, 'Mini desktop backpressure limit reached')
    }
  })

  options.ipc.on(ACK_CHANNEL, (event, raw) => {
    const id = String(raw?.id || '')
    const key = entryKey(event.sender, id)
    const entry = entries.get(key)
    const bytes = Number(raw?.bytes)

    if (!entry) {
      return
    }

    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > entry.outstandingBytes) {
      void closeEntry(key, 'Mini desktop acknowledgement denied')

      return
    }

    entry.outstandingBytes -= bytes

    if (entry.paused && entry.outstandingBytes <= INBOUND_RESUME_BYTES) {
      entry.paused = false
      entry.socket.resume()
    }
  })

  options.ipc.on(CLOSE_CHANNEL, (event, raw) => {
    const key = entryKey(event.sender, String(raw?.id || ''))
    cancelPendingStart(key)
    void closeEntry(key)
  })

  return {
    disposeOwner(owner) {
      for (const pending of pendingStarts.values()) {
        if (pending.owner === owner) {
          pending.cancelled = true
        }
      }

      for (const [key, entry] of entries) {
        if (entry.owner === owner) {
          void closeEntry(key, 'renderer destroyed')
        }
      }
    }
  }
}

export const MINI_DESKTOP_CHANNELS = Object.freeze({
  ack: ACK_CHANNEL,
  close: CLOSE_CHANNEL,
  event: EVENT_CHANNEL,
  send: SEND_CHANNEL,
  start: START_CHANNEL
})
