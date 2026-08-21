import { describe, expect, it } from 'vitest'

import { SSH_REMOTE_RUNTIME_POLICY as fallbackPolicy } from './ssh-remote-runtime-policy.full'
import { SSH_REMOTE_RUNTIME_POLICY as miniPolicy } from './ssh-remote-runtime-policy.mini'

describe('SSH remote runtime policy', () => {
  it('keeps the fallback SSH client operator-configurable', () => {
    expect(fallbackPolicy).toEqual({ fixedHermesPath: '', hermesPathReadOnly: false })
  })

  it('pins the Mini client to the staged runtime wrapper', () => {
    expect(miniPolicy).toEqual({
      fixedHermesPath: '/usr/local/bin/hermes-korgo',
      hermesPathReadOnly: true
    })
  })
})
