export interface MiniDesktopEvent {
  data?: unknown
  id: string
  reason?: string
  type: 'close' | 'error' | 'message' | 'open'
}

export interface MiniDesktopBridge {
  ack: (id: string, bytes: number) => void
  close: (id: string) => void
  onEvent: (callback: (event: MiniDesktopEvent) => void) => () => void
  send: (id: string, data: ArrayBuffer | Uint8Array) => void
  start: (id: string) => Promise<void>
}

export class MiniDesktopChannel {
  binaryType = 'arraybuffer'
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  protocol = ''
  readyState: number = WebSocket.CONNECTING

  readonly #bridge: MiniDesktopBridge
  readonly #id: string
  #startRequested = false
  #unsubscribe: (() => void) | null

  constructor(bridge: MiniDesktopBridge) {
    this.#bridge = bridge
    this.#id = globalThis.crypto.randomUUID()
    this.#unsubscribe = bridge.onEvent(event => {
      if (event.id !== this.#id) {
        return
      }

      if (event.type === 'open') {
        this.readyState = WebSocket.OPEN
        this.onopen?.(new Event('open'))
      } else if (event.type === 'message') {
        const data = event.data instanceof Uint8Array ? event.data.slice().buffer : event.data
        const bytes = data instanceof ArrayBuffer ? data.byteLength : 0

        try {
          this.onmessage?.(new MessageEvent('message', { data }))
        } finally {
          if (bytes > 0) {
            this.#bridge.ack(this.#id, bytes)
          }
        }
      } else if (event.type === 'error') {
        this.onerror?.(new Event('error'))
      } else {
        this.#finishClose(event.reason || '')
      }
    })

    queueMicrotask(() => {
      if (this.readyState !== WebSocket.CONNECTING) {
        return
      }

      this.#startRequested = true
      void bridge.start(this.#id).catch(error => {
        if (this.readyState === WebSocket.CLOSED) {
          return
        }

        this.onerror?.(Object.assign(new Event('error'), { error }))
        this.#finishClose(error instanceof Error ? error.message : String(error))
      })
    })
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new DOMException('Mini desktop channel is not open.', 'InvalidStateError')
    }

    this.#bridge.send(
      this.#id,
      ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data
    )
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) {
      return
    }

    this.readyState = WebSocket.CLOSING

    if (!this.#startRequested) {
      this.#finishClose('')

      return
    }

    this.#bridge.close(this.#id)
  }

  #finishClose(reason: string): void {
    if (this.readyState === WebSocket.CLOSED) {
      return
    }

    this.readyState = WebSocket.CLOSED
    this.onclose?.(new CloseEvent('close', { code: 1000, reason }))
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }
}
