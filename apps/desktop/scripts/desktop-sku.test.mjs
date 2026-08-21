import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { test } from 'vitest'

import { validateDesktopBuildEnvironment } from './desktop-sku.mjs'

test('desktop build identity accepts aligned full and strict SKUs', () => {
  assert.equal(validateDesktopBuildEnvironment({}), 'hermes')
  assert.equal(validateDesktopBuildEnvironment({ HERMES_DESKTOP_PRODUCT: 'bot' }), 'bot')
  assert.equal(
    validateDesktopBuildEnvironment({
      HERMES_DESKTOP_PRODUCT: 'bot',
      HERMES_DESKTOP_SKU: 'bot-linux-mini',
      VITE_HERMES_DESKTOP_PRODUCT: 'bot',
      VITE_HERMES_DESKTOP_SKU: 'bot-linux-mini'
    }),
    'bot-linux-mini'
  )
})

test('desktop build identity rejects typos and every explicit mismatch', () => {
  assert.throws(() => validateDesktopBuildEnvironment({ HERMES_DESKTOP_SKU: 'bot-linux-minii' }), /Unknown/)
  assert.throws(() => validateDesktopBuildEnvironment({ HERMES_DESKTOP_PRODUCT: 'enterprise' }), /Unknown/)
  assert.throws(
    () =>
      validateDesktopBuildEnvironment({
        HERMES_DESKTOP_PRODUCT: 'hermes',
        HERMES_DESKTOP_SKU: 'bot-linux-mini'
      }),
    /Mismatched/
  )
  assert.throws(
    () =>
      validateDesktopBuildEnvironment({
        HERMES_DESKTOP_SKU: 'bot-linux-mini',
        VITE_HERMES_DESKTOP_SKU: 'bot-ssh-only'
      }),
    /Mismatched main\/renderer/
  )
  assert.throws(
    () =>
      validateDesktopBuildEnvironment(
        { HERMES_DESKTOP_SKU: 'bot-linux-mini' },
        { requireAligned: true }
      ),
    /must both be explicit/
  )
})

test('build entry scripts reject typo and missing-half identities before invoking build tools', () => {
  const desktopRoot = path.resolve(import.meta.dirname, '..')
  const script = path.join(desktopRoot, 'scripts', 'bundle-electron-main.mjs')
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.includes('HERMES_DESKTOP_SKU') && !key.includes('HERMES_DESKTOP_PRODUCT'))
  )

  for (const patch of [
    { HERMES_DESKTOP_SKU: 'bot-linux-minii', VITE_HERMES_DESKTOP_SKU: 'bot-linux-minii' },
    { HERMES_DESKTOP_SKU: 'bot-linux-mini', HERMES_DESKTOP_PRODUCT: 'bot' },
    {
      HERMES_DESKTOP_PRODUCT: 'bot',
      HERMES_DESKTOP_SKU: 'bot-linux-mini',
      VITE_HERMES_DESKTOP_PRODUCT: 'bot',
      VITE_HERMES_DESKTOP_SKU: 'bot-ssh-only'
    }
  ]) {
    const result = spawnSync(process.execPath, [script], {
      cwd: desktopRoot,
      encoding: 'utf8',
      env: { ...cleanEnv, ...patch }
    })

    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /Unknown|Mismatched|must both be explicit/)
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /electron-main\.mjs.*kb/i)
  }
})
