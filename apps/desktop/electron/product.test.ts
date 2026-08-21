import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  allowsGenericHermesUpdates,
  BOT_APP_ID,
  BOT_APP_NAME,
  BOT_TEMPLATE_REF,
  BOT_UPDATE_POLICY,
  DESKTOP_SKU,
  desktopAppId,
  desktopAppName,
  desktopSku,
  isBotProduct,
  isLinuxMiniProduct,
  isSshOnlyProduct,
  resolveDesktopSku
} from './product'
import { desktopCapabilitiesForSku, FULL_DESKTOP_POLICY, LINUX_MINI_POLICY } from './product-capabilities'
import { DESKTOP_CONNECTION_MODES, SSH_ONLY_CAPABILITY_NAMES, SSH_ONLY_POLICY } from './ssh-only-policy'

test('desktop identity derives from the immutable compile-time SKU', () => {
  assert.equal(BOT_APP_NAME, 'Korgo Bot')
  assert.equal(BOT_TEMPLATE_REF, 'system/hermes-agent@1.0.0')
  assert.equal(BOT_UPDATE_POLICY, 'source-release')
  assert.equal(allowsGenericHermesUpdates(), !isBotProduct())
  assert.equal(desktopSku(), DESKTOP_SKU)
  assert.equal(isSshOnlyProduct(), DESKTOP_SKU === 'bot-linux-mini' || DESKTOP_SKU === 'bot-ssh-only')
  assert.equal(isLinuxMiniProduct(), DESKTOP_SKU === 'bot-linux-mini')

  if (DESKTOP_SKU !== 'hermes') {
    assert.equal(isBotProduct(), true)
    assert.equal(desktopAppName(), process.env.HERMES_DESKTOP_APP_NAME || BOT_APP_NAME)
    assert.equal(desktopAppId(), BOT_APP_ID)

    return
  }

  assert.equal(isBotProduct(), false)
  assert.equal(desktopAppId(), 'com.nousresearch.hermes')
})

test('runtime environment changes cannot change the captured SKU or its capabilities', () => {
  const originalSku = process.env.HERMES_DESKTOP_SKU
  const originalProduct = process.env.HERMES_DESKTOP_PRODUCT
  const capturedSku = desktopSku()
  const capturedCapabilities = desktopCapabilitiesForSku(capturedSku)

  try {
    process.env.HERMES_DESKTOP_SKU = capturedSku === 'bot-ssh-only' ? 'hermes' : 'bot-ssh-only'
    process.env.HERMES_DESKTOP_PRODUCT = capturedSku === 'hermes' ? 'bot' : 'hermes'
    assert.equal(desktopSku(), capturedSku)
    assert.equal(desktopCapabilitiesForSku(desktopSku()), capturedCapabilities)
  } finally {
    if (originalSku === undefined) {
      delete process.env.HERMES_DESKTOP_SKU
    } else {
      process.env.HERMES_DESKTOP_SKU = originalSku
    }

    if (originalProduct === undefined) {
      delete process.env.HERMES_DESKTOP_PRODUCT
    } else {
      process.env.HERMES_DESKTOP_PRODUCT = originalProduct
    }
  }
})

test('explicit unknown SKU or product values fail closed instead of widening to a full build', () => {
  assert.throws(() => resolveDesktopSku('bot-minii', 'bot'), /Unknown desktop SKU/)
  assert.throws(() => resolveDesktopSku(undefined, 'enterprise'), /Unknown desktop product/)
  assert.throws(() => resolveDesktopSku('bot-linux-mini', 'hermes'), /Mismatched desktop SKU\/product/)
  assert.throws(() => resolveDesktopSku('hermes', 'bot'), /Mismatched desktop SKU\/product/)
  assert.equal(resolveDesktopSku(undefined, undefined), 'hermes')
})

test('full and bot SKUs retain the complete policy while strict SSH SKUs stay fail closed', () => {
  for (const sku of ['hermes', 'bot'] as const) {
    assert.equal(desktopCapabilitiesForSku(sku), FULL_DESKTOP_POLICY)
    assert.deepEqual(desktopCapabilitiesForSku(sku).allowedConnectionModes, DESKTOP_CONNECTION_MODES)
  }

  assert.equal(desktopCapabilitiesForSku('bot-ssh-only'), SSH_ONLY_POLICY)
  assert.equal(desktopCapabilitiesForSku('bot-linux-mini'), LINUX_MINI_POLICY)

  for (const capability of SSH_ONLY_CAPABILITY_NAMES) {
    assert.equal(desktopCapabilitiesForSku('bot-ssh-only')[capability], false)
    assert.equal(
      desktopCapabilitiesForSku('bot-linux-mini')[capability],
      capability === 'allowComputerSurface',
      capability
    )
  }

  assert.deepEqual(desktopCapabilitiesForSku('bot-linux-mini').allowedConnectionModes, ['ssh'])
})
