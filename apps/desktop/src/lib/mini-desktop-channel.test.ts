import { describe, expect, it, vi } from 'vitest'

import { type MiniDesktopBridge, MiniDesktopChannel, type MiniDesktopEvent } from './mini-desktop-channel'

function harness() {
  let listener: ((event: MiniDesktopEvent) => void) | null = null
  const unsubscribe = vi.fn()

  const bridge: MiniDesktopBridge = {
    ack: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn(callback => {
      listener = callback

      return unsubscribe
    }),
    send: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined)
  }

  const channel = new MiniDesktopChannel(bridge)

  return {
    bridge,
    channel,
    emit: (event: MiniDesktopEvent) => listener?.(event),
    id: () => String((bridge.start as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] || ''),
    unsubscribe
  }
}

describe('MiniDesktopChannel', () => {
  it('starts through the fixed preload bridge and forwards binary VNC frames only after open', async () => {
    const h = harness()
    await vi.waitFor(() => expect(h.bridge.start).toHaveBeenCalledOnce())
    const id = h.id()

    expect(id).toMatch(/^[0-9a-f-]{8,}$/i)
    expect(() => h.channel.send(new Uint8Array([1]))).toThrow(/not open/)

    const opened = vi.fn()
    h.channel.onopen = opened
    h.emit({ id, type: 'open' })
    expect(h.channel.readyState).toBe(WebSocket.OPEN)
    expect(opened).toHaveBeenCalledOnce()

    h.channel.send(new Uint8Array([1, 2, 3]))
    expect(h.bridge.send).toHaveBeenCalledWith(id, expect.any(Uint8Array))
    expect([...(h.bridge.send as ReturnType<typeof vi.fn>).mock.calls[0][1]]).toEqual([1, 2, 3])
  })

  it('ignores other channel ids and unsubscribes after the owned close event', async () => {
    const h = harness()
    await vi.waitFor(() => expect(h.bridge.start).toHaveBeenCalledOnce())
    const id = h.id()
    const message = vi.fn()
    const closed = vi.fn()
    h.channel.onmessage = message
    h.channel.onclose = closed

    h.emit({ data: new Uint8Array([9]), id: 'another-channel', type: 'message' })
    expect(message).not.toHaveBeenCalled()

    h.emit({ id, type: 'open' })
    h.emit({ data: new Uint8Array([4, 5]), id, type: 'message' })
    expect(message.mock.calls[0][0].data).toBeInstanceOf(ArrayBuffer)
    expect(h.bridge.ack).toHaveBeenCalledWith(id, 2)

    h.emit({ id, reason: 'tunnel closed', type: 'close' })
    expect(h.channel.readyState).toBe(WebSocket.CLOSED)
    expect(closed.mock.calls[0][0].reason).toBe('tunnel closed')
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })

  it('requests bridge shutdown exactly once', async () => {
    const h = harness()
    await vi.waitFor(() => expect(h.bridge.start).toHaveBeenCalledOnce())
    const id = h.id()
    h.emit({ id, type: 'open' })

    h.channel.close()
    h.channel.close()

    expect(h.bridge.close).toHaveBeenCalledOnce()
    expect(h.bridge.close).toHaveBeenCalledWith(id)
    expect(h.channel.readyState).toBe(WebSocket.CLOSING)
  })

  it('does not start or signal main when closed synchronously', async () => {
    const h = harness()

    h.channel.close()
    await Promise.resolve()

    expect(h.bridge.start).not.toHaveBeenCalled()
    expect(h.bridge.close).not.toHaveBeenCalled()
    expect(h.channel.readyState).toBe(WebSocket.CLOSED)
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })

  it('acknowledges an inbound frame even when its consumer throws', async () => {
    const h = harness()
    await vi.waitFor(() => expect(h.bridge.start).toHaveBeenCalledOnce())
    const id = h.id()

    h.channel.onmessage = () => {
      throw new Error('consumer failed')
    }

    expect(() => h.emit({ data: new Uint8Array([1, 2, 3]), id, type: 'message' })).toThrow(/consumer failed/)
    expect(h.bridge.ack).toHaveBeenCalledWith(id, 3)
  })
})
