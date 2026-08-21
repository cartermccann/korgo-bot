import { useStore } from '@nanostores/react'
import type RFB from '@novnc/novnc'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'
import { RefreshCw } from '@/lib/icons'
import { MiniDesktopChannel } from '@/lib/mini-desktop-channel'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import type { CronJob } from '@/types/hermes'

import { $orgoDesktopOpen } from '../store'

import { AgentRoutines, RoutineEditor } from './routines'

type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error'
type RfbModule = { default: typeof RFB }

interface MiniDesktopPaneProps {
  loadRfb?: () => Promise<RfbModule>
}

const loadDefaultRfb = () => import('@novnc/novnc')

export function MiniDesktopPane({ loadRfb = loadDefaultRfb }: MiniDesktopPaneProps = {}) {
  const { t } = useI18n()
  const copy = t.rightSidebar.desktop
  const visible = useStore($orgoDesktopOpen)
  const activeProfile = normalizeProfileKey(useStore($activeGatewayProfile))
  const screenRef = useRef<HTMLDivElement>(null)
  const channelRef = useRef<MiniDesktopChannel | null>(null)
  const generationRef = useRef(0)
  const rfbRef = useRef<RFB | null>(null)
  const [state, setState] = useState<ConnectionState>('disconnected')
  const [error, setError] = useState('')
  const [routine, setRoutine] = useState<CronJob | null>(null)
  const [routinesRevision, setRoutinesRevision] = useState(0)

  const teardown = useCallback(() => {
    generationRef.current += 1
    const rfb = rfbRef.current
    const channel = channelRef.current
    rfbRef.current = null
    channelRef.current = null

    try {
      rfb?.disconnect()
    } catch {
      // The raw channel may already have been closed by the SSH tunnel.
    }

    channel?.close()
  }, [])

  const disconnect = useCallback(() => {
    teardown()

    setState('disconnected')
  }, [teardown])

  const connect = useCallback(async () => {
    const target = screenRef.current
    const bridge = window.hermesDesktop.miniDesktop

    if (!target || !bridge) {
      setState('error')
      setError('Mini computer bridge unavailable.')

      return
    }

    teardown()
    const generation = generationRef.current
    target.replaceChildren()
    setError('')
    setState('connecting')

    try {
      const { default: RfbConstructor } = await loadRfb()

      if (generation !== generationRef.current || screenRef.current !== target) {
        return
      }

      const channel = new MiniDesktopChannel(bridge)
      channelRef.current = channel
      let rfb: RFB

      try {
        rfb = new RfbConstructor(target, channel as unknown as WebSocket, { shared: true })
      } catch (reason) {
        channelRef.current = null
        channel.close()
        throw reason
      }

      if (generation !== generationRef.current || screenRef.current !== target) {
        try {
          rfb.disconnect()
        } finally {
          channelRef.current = null
          channel.close()
        }

        return
      }

      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.viewOnly = false
      rfb.addEventListener('connect', () => {
        if (generation === generationRef.current && rfbRef.current === rfb) {
          setState('connected')
        }
      })
      rfb.addEventListener('disconnect', event => {
        if (generation !== generationRef.current || rfbRef.current !== rfb) {
          return
        }

        rfbRef.current = null
        channelRef.current = null
        channel.close()
        setState('error')
        setError((event as CustomEvent<{ clean?: boolean }>).detail?.clean ? '' : copy.disconnectedUnexpectedly)
      })
      rfb.addEventListener('securityfailure', () => {
        if (generation !== generationRef.current || rfbRef.current !== rfb) {
          return
        }

        setState('error')
        setError(copy.securityFailure)
      })
      rfbRef.current = rfb
    } catch (reason) {
      if (generation !== generationRef.current) {
        return
      }

      setState('error')
      setError(reason instanceof Error ? reason.message : copy.connectionFailed)
    }
  }, [copy.connectionFailed, copy.disconnectedUnexpectedly, copy.securityFailure, loadRfb, teardown])

  useEffect(() => {
    if (visible && !routine) {
      void connect()
    } else {
      disconnect()
    }

    return teardown
  }, [connect, disconnect, routine, teardown, visible])

  if (routine) {
    return (
      <div className="h-full min-h-0 bg-(--ui-editor-surface-background)">
        <RoutineEditor
          job={routine}
          onClose={changed => {
            if (changed) {
              setRoutinesRevision(value => value + 1)
            }

            setRoutine(null)
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-(--ui-editor-surface-background)">
      <section className="shrink-0 p-2.5 pb-1.5">
        <div className="relative aspect-video overflow-hidden rounded-md border border-(--ui-stroke-secondary) bg-black">
          <div aria-label={copy.title} className="h-full w-full" ref={screenRef} />
          {state !== 'connected' ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/70 px-4 text-center">
              <div className="grid justify-items-center gap-2 text-[0.68rem] text-(--ui-text-secondary)">
                {state === 'connecting' ? <Loader /> : null}
                <span>{state === 'connecting' ? copy.connecting : error || copy.disconnected}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex h-8 items-center justify-between gap-2 pt-1">
          <p className="truncate text-[0.68rem] text-(--ui-text-tertiary)">{copy.title}</p>
          <Button aria-label={copy.reconnect} onClick={() => void connect()} size="icon-xs" variant="ghost">
            <RefreshCw />
          </Button>
        </div>
      </section>

      <AgentRoutines
        activeProfile={activeProfile}
        key={`${activeProfile}:${routinesRevision}`}
        onEdit={job => setRoutine(job)}
      />
    </div>
  )
}
