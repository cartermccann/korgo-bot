/** Build-time product SKU. Generic Hermes Desktop stays the default. */
export const BOT_PROVIDER_IDS = ['openai-codex', 'xai-oauth'] as const
export const BOT_APP_ICON_ASSET = 'korgo-bot-icon.png'
export const BOT_APP_NAME = 'Korgo Bot'
export const BOT_UPDATE_POLICY = 'source-release' as const

export type BotProviderId = (typeof BOT_PROVIDER_IDS)[number]
export type DesktopSku = 'hermes' | 'bot' | 'bot-linux-mini' | 'bot-ssh-only'

export function resolveDesktopSku(sku: string | undefined, product: string | undefined): DesktopSku {
  if (sku && sku !== 'bot' && sku !== 'hermes' && sku !== 'bot-linux-mini' && sku !== 'bot-ssh-only') {
    throw new Error(`Unknown desktop SKU: ${sku}`)
  }

  if (product && product !== 'bot' && product !== 'hermes') {
    throw new Error(`Unknown desktop product: ${product}`)
  }

  if (sku && product && (sku === 'hermes' ? 'hermes' : 'bot') !== product) {
    throw new Error(`Mismatched desktop SKU/product: ${sku} cannot use product ${product}`)
  }

  if (sku === 'bot' || sku === 'hermes' || sku === 'bot-linux-mini' || sku === 'bot-ssh-only') {
    return sku
  }

  return product === 'bot' || product === 'hermes' ? product : 'hermes'
}

/** Vite replaces these environment reads at compile time for packaged builds. */
export const DESKTOP_SKU: DesktopSku = resolveDesktopSku(
  import.meta.env.VITE_HERMES_DESKTOP_SKU,
  import.meta.env.VITE_HERMES_DESKTOP_PRODUCT
)

export function desktopSku(): DesktopSku {
  return DESKTOP_SKU
}

export function isBotProduct(): boolean {
  return DESKTOP_SKU !== 'hermes'
}

export function isSshOnlyProduct(): boolean {
  return DESKTOP_SKU === 'bot-linux-mini' || DESKTOP_SKU === 'bot-ssh-only'
}

export function isLinuxMiniProduct(): boolean {
  return DESKTOP_SKU === 'bot-linux-mini'
}

/** Bot releases test the desktop against a pinned compatible remote backend.
 * Never route this SKU through generic Hermes update endpoints. */
export function allowsGenericHermesUpdates(): boolean {
  return !isBotProduct()
}

export function isBotProviderId(id: string): boolean {
  return (BOT_PROVIDER_IDS as readonly string[]).includes(id)
}

export function filterBotProviders<T extends { id: string }>(providers: T[]): T[] {
  if (!isBotProduct()) {
    return providers
  }

  return providers.filter(provider => isBotProviderId(provider.id))
}
