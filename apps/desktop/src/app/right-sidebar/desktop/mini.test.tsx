import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MiniDesktopBridge } from '@/lib/mini-desktop-channel'

import { setOrgoDesktopOpen } from '../store'

vi.mock('./routines', () => ({
  AgentRoutines: () => <div>Routines</div>,
  RoutineEditor: () => <div>Routine editor</div>
}))

import { MiniDesktopPane } from './mini'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void

  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

function bridgeHarness() {
  const unsubscribe = vi.fn()

  const bridge: MiniDesktopBridge = {
    ack: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn(() => unsubscribe),
    send: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined)
  }

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { miniDesktop: bridge }
  })

  return { bridge, unsubscribe }
}

describe('MiniDesktopPane lifecycle', () => {
  beforeEach(() => {
    setOrgoDesktopOpen(true)
  })

  afterEach(() => {
    cleanup()
    setOrgoDesktopOpen(false)
    vi.restoreAllMocks()
  })

  it('does not construct or start a channel when unmounted during the deferred noVNC import', async () => {
    const h = bridgeHarness()
    const gate = deferred<{ default: any }>()
    const construct = vi.fn()
    const loadRfb = vi.fn(() => gate.promise)
    const view = render(<MiniDesktopPane loadRfb={loadRfb} />)

    await waitFor(() => expect(loadRfb).toHaveBeenCalledOnce())
    view.unmount()

    class Rfb {
      constructor() {
        construct()
      }
    }

    await act(async () => {
      gate.resolve({ default: Rfb })
      await gate.promise
      await Promise.resolve()
    })

    expect(construct).not.toHaveBeenCalled()
    expect(h.bridge.start).not.toHaveBeenCalled()
    expect(h.bridge.close).not.toHaveBeenCalled()
  })

  it('closes the newly created channel if the noVNC constructor throws', async () => {
    const h = bridgeHarness()

    class ThrowingRfb {
      constructor() {
        throw new Error('noVNC constructor failed')
      }
    }

    render(<MiniDesktopPane loadRfb={async () => ({ default: ThrowingRfb as any })} />)

    expect(await screen.findByText('noVNC constructor failed')).toBeTruthy()
    await act(async () => Promise.resolve())

    // Constructor failure is synchronous, so MiniDesktopChannel closes before
    // its queued start and never opens a main-process forward.
    expect(h.bridge.start).not.toHaveBeenCalled()
    expect(h.bridge.close).not.toHaveBeenCalled()
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })
})
