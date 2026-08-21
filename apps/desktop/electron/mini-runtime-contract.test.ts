import assert from 'node:assert/strict'

import { test } from 'vitest'

import { parseMiniRuntimeContract } from './mini-runtime-contract'

test('accepts only the staged tenant ownership root and sandbox Hermes home', () => {
  assert.deepEqual(
    parseMiniRuntimeContract(
      'lock_dir=/home/cjm/.hermes-korgo-stage/tenant/home/.hermes/desktop-ssh\n' + 'hermes_home=/state/hermes\n'
    ),
    {
      remoteHermesHome: '/state/hermes',
      remoteLockDir: '/home/cjm/.hermes-korgo-stage/tenant/home/.hermes/desktop-ssh'
    }
  )
})

test('rejects regular Hermes state, path traversal, malformed, and widened contracts', () => {
  for (const value of [
    'lock_dir=/home/cjm/.hermes/desktop-ssh\nhermes_home=/state/hermes',
    'lock_dir=/home/cjm/../root/tenant/home/.hermes/desktop-ssh\nhermes_home=/state/hermes',
    'lock_dir=/tmp/tenant/home/.hermes/desktop-ssh\nhermes_home=/home/cjm/.hermes',
    'lock_dir=/safe/tenant/home/.hermes/desktop-ssh\nextra=yes\nhermes_home=/state/hermes',
    'not-json'
  ]) {
    assert.throws(() => parseMiniRuntimeContract(value), /invalid|unsafe/)
  }
})
