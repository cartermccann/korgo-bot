import assert from 'node:assert/strict'

import { test, vi } from 'vitest'

import { MINI_DESKTOP_CHANNELS, registerMiniDesktopProxy } from './mini-desktop-proxy'

function deferred<T>() {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T | PromiseLike<T>) => void

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

function harness({ alive = true } = {}) {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const listeners = new Map<string, (...args: any[]) => unknown>()
  const socketListeners = new Map<string, (...args: any[]) => void>()

  const socket = {
    destroy: vi.fn(),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      socketListeners.set(event, listener)

      return socket
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    write: vi.fn()
  }

  let ownerDestroyed = false
  const owner = { id: 1, isDestroyed: () => ownerDestroyed, send: vi.fn() }
  const other = { id: 2, isDestroyed: () => false, send: vi.fn() }

  const ssh = {
    cancelForward: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue('ready'),
    forward: vi.fn().mockResolvedValue(undefined),
    isAlive: vi.fn().mockResolvedValue(alive)
  }

  const createConnection = vi.fn(() => socket)
  const resolveSsh = vi.fn().mockResolvedValue(ssh)

  const pickLocalPort = vi.fn().mockResolvedValue(15901)

  const proxy = registerMiniDesktopProxy({
    createConnection,
    ipc: {
      handle: (channel, listener) => handlers.set(channel, listener),
      on: (channel, listener) => listeners.set(channel, listener)
    },
    pickLocalPort,
    resolveSsh
  })

  return {
    createConnection,
    destroyOwner: () => {
      ownerDestroyed = true
    },
    handlers,
    listeners,
    other,
    owner,
    pickLocalPort,
    proxy,
    resolveSsh,
    socket,
    socketListeners,
    ssh
  }
}

test('opens only a fixed loopback VNC forward and emits no SSH or VNC credentials', async () => {
  const h = harness()
  const id = 'desktop-1234'

  await h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id })
  h.socketListeners.get('connect')?.()

  assert.deepEqual(h.ssh.forward.mock.calls[0], [15901, 5901, '127.0.0.1'])
  assert.deepEqual(h.ssh.exec.mock.calls[0], ['/usr/local/bin/korgo-workspace status', { timeoutMs: 10_000 }])
  assert.deepEqual(h.createConnection.mock.calls[0], [{ host: '127.0.0.1', port: 15901 }])
  assert.deepEqual(h.owner.send.mock.calls[0], [MINI_DESKTOP_CHANNELS.event, { id, type: 'open' }])
  assert.equal(JSON.stringify(h.owner.send.mock.calls).includes('/run/korgo-ssh'), false)
})

test('fails closed before forwarding when the strict SSH connection is unavailable', async () => {
  const h = harness({ alive: false })

  await assert.rejects(
    h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id: 'desktop-1234' }) as Promise<unknown>,
    /SSH connection is unavailable/
  )
  assert.equal(h.ssh.forward.mock.calls.length, 0)
  assert.equal(h.createConnection.mock.calls.length, 0)
})

test('isolates owners, bounds renderer frames, and tears down the fixed forward', async () => {
  const h = harness()
  const id = 'desktop-5678'

  await h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id })
  h.listeners.get(MINI_DESKTOP_CHANNELS.send)?.({ sender: h.other }, { data: new Uint8Array([1]), id })
  assert.equal(h.socket.write.mock.calls.length, 0)

  h.listeners.get(MINI_DESKTOP_CHANNELS.send)?.({ sender: h.owner }, { data: new Uint8Array([1, 2, 3]), id })
  assert.deepEqual([...h.socket.write.mock.calls[0][0]], [1, 2, 3])

  h.listeners.get(MINI_DESKTOP_CHANNELS.send)?.({ sender: h.owner }, { data: new Uint8Array(4 * 1024 * 1024 + 1), id })
  await vi.waitFor(() => assert.equal(h.socket.destroy.mock.calls.length, 1))
  assert.deepEqual(h.ssh.cancelForward.mock.calls[0], [15901, 5901, '127.0.0.1'])

  h.proxy.disposeOwner(h.owner as any)
})

test('rejects duplicate channels per renderer and cancels a forward if local socket creation fails', async () => {
  const h = harness()
  await h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id: 'desktop-1111' })

  await assert.rejects(
    h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id: 'desktop-2222' }) as Promise<unknown>,
    /already active/
  )

  const failing = harness()
  failing.createConnection.mockImplementationOnce(() => {
    throw new Error('socket failed')
  })
  await assert.rejects(
    failing.handlers.get(MINI_DESKTOP_CHANNELS.start)?.(
      { sender: failing.owner },
      { id: 'desktop-3333' }
    ) as Promise<unknown>,
    /socket failed/
  )
  assert.deepEqual(failing.ssh.cancelForward.mock.calls[0], [15901, 5901, '127.0.0.1'])

  const partialSocket = harness()
  partialSocket.socket.on.mockImplementationOnce(() => {
    throw new Error('listener setup failed')
  })
  await assert.rejects(
    partialSocket.handlers.get(MINI_DESKTOP_CHANNELS.start)?.(
      { sender: partialSocket.owner },
      { id: 'desktop-4444' }
    ) as Promise<unknown>,
    /listener setup failed/
  )
  assert.equal(partialSocket.socket.destroy.mock.calls.length, 1)
  assert.deepEqual(partialSocket.ssh.cancelForward.mock.calls[0], [15901, 5901, '127.0.0.1'])
})

test('reserves the renderer before the first async SSH step so concurrent starts cannot race', async () => {
  const h = harness()
  const pendingSsh = deferred<typeof h.ssh>()

  h.resolveSsh.mockImplementationOnce(() => pendingSsh.promise)

  const first = h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.(
    { sender: h.owner },
    { id: 'desktop-aaaa' }
  ) as Promise<unknown>

  await assert.rejects(
    h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id: 'desktop-bbbb' }) as Promise<unknown>,
    /already active/
  )

  pendingSsh.resolve(h.ssh)
  await first
  assert.equal(h.ssh.forward.mock.calls.length, 1)
  assert.equal(h.createConnection.mock.calls.length, 1)
})

test('closes the channel instead of buffering when the local VNC socket applies backpressure', async () => {
  const h = harness()
  const id = 'desktop-cccc'
  h.socket.write.mockReturnValueOnce(false)
  await h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id })

  h.listeners.get(MINI_DESKTOP_CHANNELS.send)?.({ sender: h.owner }, { data: new Uint8Array([1, 2, 3]), id })

  await vi.waitFor(() => assert.equal(h.socket.destroy.mock.calls.length, 1))
  assert.deepEqual(h.ssh.cancelForward.mock.calls[0], [15901, 5901, '127.0.0.1'])
  assert.deepEqual(h.owner.send.mock.calls.at(-1), [
    MINI_DESKTOP_CHANNELS.event,
    { id, reason: 'Mini desktop backpressure limit reached', type: 'close' }
  ])
})

test.each([
  [
    'SSH resolution',
    (h: ReturnType<typeof harness>, gate: ReturnType<typeof deferred<any>>) =>
      h.resolveSsh.mockReturnValueOnce(gate.promise),
    h => h.ssh,
    false
  ],
  [
    'liveness probe',
    (h: ReturnType<typeof harness>, gate: ReturnType<typeof deferred<any>>) =>
      h.ssh.isAlive.mockReturnValueOnce(gate.promise),
    () => true,
    false
  ],
  [
    'workspace probe',
    (h: ReturnType<typeof harness>, gate: ReturnType<typeof deferred<any>>) =>
      h.ssh.exec.mockReturnValueOnce(gate.promise),
    () => 'ready',
    false
  ],
  [
    'local-port selection',
    (h: ReturnType<typeof harness>, gate: ReturnType<typeof deferred<any>>) =>
      h.pickLocalPort.mockReturnValueOnce(gate.promise),
    () => 15901,
    false
  ],
  [
    'forward creation',
    (h: ReturnType<typeof harness>, gate: ReturnType<typeof deferred<any>>) =>
      h.ssh.forward.mockReturnValueOnce(gate.promise),
    () => undefined,
    true
  ]
] as const)('close cancels the exact pending start during %s', async (_label, arrange, releaseValue, forwarded) => {
  const h = harness()
  const gate = deferred<any>()
  arrange(h, gate)
  const id = 'desktop-pending'
  const start = h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id }) as Promise<unknown>

  await vi.waitFor(() => {
    if (_label === 'SSH resolution') {
      assert.equal(h.resolveSsh.mock.calls.length, 1)
    }

    if (_label === 'liveness probe') {
      assert.equal(h.ssh.isAlive.mock.calls.length, 1)
    }

    if (_label === 'workspace probe') {
      assert.equal(h.ssh.exec.mock.calls.length, 1)
    }

    if (_label === 'local-port selection') {
      assert.equal(h.pickLocalPort.mock.calls.length, 1)
    }

    if (_label === 'forward creation') {
      assert.equal(h.ssh.forward.mock.calls.length, 1)
    }
  })
  h.listeners.get(MINI_DESKTOP_CHANNELS.close)?.({ sender: h.owner }, { id })
  gate.resolve(releaseValue(h))

  await assert.rejects(start, /start cancelled/)
  assert.equal(h.createConnection.mock.calls.length, 0)
  assert.equal(h.ssh.forward.mock.calls.length, forwarded ? 1 : 0)
  assert.equal(h.ssh.cancelForward.mock.calls.length, forwarded ? 1 : 0)

  if (forwarded) {
    assert.deepEqual(h.ssh.cancelForward.mock.calls[0], [15901, 5901, '127.0.0.1'])
  }
})

test('pending cancellation is scoped to both renderer owner and channel id', async () => {
  const h = harness()
  const gate = deferred<typeof h.ssh>()
  const id = 'desktop-scoped'
  h.resolveSsh.mockReturnValueOnce(gate.promise)
  const start = h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id }) as Promise<unknown>

  h.listeners.get(MINI_DESKTOP_CHANNELS.close)?.({ sender: h.other }, { id })
  h.listeners.get(MINI_DESKTOP_CHANNELS.close)?.({ sender: h.owner }, { id: 'desktop-other' })
  h.proxy.disposeOwner(h.other as any)
  gate.resolve(h.ssh)

  await start
  assert.equal(h.ssh.forward.mock.calls.length, 1)
  assert.equal(h.createConnection.mock.calls.length, 1)
})

test('disposeOwner cancels a pending opened forward and a destroyed owner never retains a channel', async () => {
  const h = harness()
  const gate = deferred<void>()
  h.ssh.forward.mockReturnValueOnce(gate.promise)

  const start = h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.(
    { sender: h.owner },
    { id: 'desktop-dispose' }
  ) as Promise<unknown>

  await vi.waitFor(() => assert.equal(h.ssh.forward.mock.calls.length, 1))
  h.destroyOwner()
  h.proxy.disposeOwner(h.owner as any)
  gate.resolve()

  await assert.rejects(start, /start cancelled/)
  assert.equal(h.createConnection.mock.calls.length, 0)
  assert.deepEqual(h.ssh.cancelForward.mock.calls[0], [15901, 5901, '127.0.0.1'])
  assert.equal(h.owner.send.mock.calls.length, 0)

  await assert.rejects(
    h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id: 'desktop-destroyed' }) as Promise<unknown>,
    /owner is unavailable/
  )
})

test('keeps the renderer reserved until cancellation cleanup finishes', async () => {
  const h = harness()
  const forwardGate = deferred<void>()
  const cleanupGate = deferred<void>()
  h.ssh.forward.mockReturnValueOnce(forwardGate.promise)
  h.ssh.cancelForward.mockReturnValueOnce(cleanupGate.promise)
  const id = 'desktop-cleanup'
  const start = h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id }) as Promise<unknown>

  await vi.waitFor(() => assert.equal(h.ssh.forward.mock.calls.length, 1))
  h.listeners.get(MINI_DESKTOP_CHANNELS.close)?.({ sender: h.owner }, { id })
  forwardGate.resolve()
  await vi.waitFor(() => assert.equal(h.ssh.cancelForward.mock.calls.length, 1))

  await assert.rejects(
    h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.(
      { sender: h.owner },
      { id: 'desktop-replacement' }
    ) as Promise<unknown>,
    /already active/
  )

  cleanupGate.resolve()
  await assert.rejects(start, /start cancelled/)
})

test('an active channel closes without emitting when its owner is destroyed', async () => {
  const h = harness()
  await h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id: 'desktop-destroyed-active' })
  h.destroyOwner()
  h.socketListeners.get('connect')?.()

  await vi.waitFor(() => assert.equal(h.socket.destroy.mock.calls.length, 1))
  assert.equal(h.owner.send.mock.calls.length, 0)
  assert.deepEqual(h.ssh.cancelForward.mock.calls[0], [15901, 5901, '127.0.0.1'])
})

test('bounds unacknowledged inbound bytes and resumes only after the owning renderer acknowledges them', async () => {
  const h = harness()
  const id = 'desktop-inbound'
  await h.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: h.owner }, { id })
  const frame = new Uint8Array(4 * 1024 * 1024)

  h.socketListeners.get('data')?.(frame)
  assert.equal(h.socket.pause.mock.calls.length, 1)
  assert.equal(h.socket.resume.mock.calls.length, 0)

  h.listeners.get(MINI_DESKTOP_CHANNELS.ack)?.({ sender: h.other }, { bytes: frame.byteLength, id })
  assert.equal(h.socket.resume.mock.calls.length, 0)

  h.listeners.get(MINI_DESKTOP_CHANNELS.ack)?.({ sender: h.owner }, { bytes: frame.byteLength, id })
  assert.equal(h.socket.resume.mock.calls.length, 1)
})

test('fails closed if inbound bytes exceed the outstanding window or an acknowledgement is invalid', async () => {
  const overflow = harness()
  const id = 'desktop-overflow'
  await overflow.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: overflow.owner }, { id })
  overflow.socketListeners.get('data')?.(new Uint8Array(3 * 1024 * 1024))
  overflow.socketListeners.get('data')?.(new Uint8Array(2 * 1024 * 1024))
  await vi.waitFor(() => assert.equal(overflow.socket.destroy.mock.calls.length, 1))
  assert.deepEqual(overflow.ssh.cancelForward.mock.calls[0], [15901, 5901, '127.0.0.1'])

  const invalidAck = harness()
  await invalidAck.handlers.get(MINI_DESKTOP_CHANNELS.start)?.({ sender: invalidAck.owner }, { id })
  invalidAck.socketListeners.get('data')?.(new Uint8Array([1, 2, 3]))
  invalidAck.listeners.get(MINI_DESKTOP_CHANNELS.ack)?.({ sender: invalidAck.owner }, { bytes: 4, id })
  await vi.waitFor(() => assert.equal(invalidAck.socket.destroy.mock.calls.length, 1))
})
