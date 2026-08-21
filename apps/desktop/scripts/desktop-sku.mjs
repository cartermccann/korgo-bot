export const DESKTOP_SKUS = Object.freeze(['hermes', 'bot', 'bot-linux-mini', 'bot-ssh-only'])
export const DESKTOP_PRODUCTS = Object.freeze(['hermes', 'bot'])

const SKU_SET = new Set(DESKTOP_SKUS)
const PRODUCT_SET = new Set(DESKTOP_PRODUCTS)

function validateValue(label, value, allowed) {
  if (value && !allowed.has(value)) {
    throw new Error(`Unknown ${label}: ${value}`)
  }
}

function productForSku(sku) {
  return sku === 'hermes' ? 'hermes' : 'bot'
}

function resolveIdentity(sku, product, label) {
  validateValue(`${label} SKU`, sku, SKU_SET)
  validateValue(`${label} product`, product, PRODUCT_SET)

  if (sku && product && productForSku(sku) !== product) {
    throw new Error(`Mismatched ${label} SKU/product: ${sku} cannot use product ${product}`)
  }

  return sku || product || 'hermes'
}

/**
 * Validate every build-time identity source before a script performs work.
 * Main and renderer variables may be supplied independently by legacy tasks,
 * but when both sides are explicit they must select the exact same SKU.
 */
export function validateDesktopBuildEnvironment(env = process.env, { requireAligned = false } = {}) {
  const mainExplicit = Boolean(env.HERMES_DESKTOP_SKU || env.HERMES_DESKTOP_PRODUCT)
  const rendererExplicit = Boolean(env.VITE_HERMES_DESKTOP_SKU || env.VITE_HERMES_DESKTOP_PRODUCT)
  const mainSku = resolveIdentity(env.HERMES_DESKTOP_SKU, env.HERMES_DESKTOP_PRODUCT, 'desktop')
  const rendererSku = resolveIdentity(
    env.VITE_HERMES_DESKTOP_SKU,
    env.VITE_HERMES_DESKTOP_PRODUCT,
    'renderer desktop'
  )

  if (requireAligned && mainExplicit !== rendererExplicit) {
    throw new Error('Main and renderer desktop identities must both be explicit for this build step.')
  }

  if (mainExplicit && rendererExplicit && mainSku !== rendererSku) {
    throw new Error(`Mismatched main/renderer desktop SKU: ${mainSku} != ${rendererSku}`)
  }

  return mainExplicit ? mainSku : rendererExplicit ? rendererSku : 'hermes'
}
