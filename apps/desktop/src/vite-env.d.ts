/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HERMES_DESKTOP_PRODUCT?: string
  readonly VITE_HERMES_DESKTOP_SKU?: 'hermes' | 'bot' | 'bot-linux-mini' | 'bot-ssh-only'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '@bot-mode/plugin' {
  import type { HermesPlugin } from '@hermes/plugin-sdk'

  const plugin: HermesPlugin
  export default plugin
}

declare module '@desktop/bot-profile-create-policy' {
  export const PROFILE_CREATE_POLICY: Readonly<Record<string, unknown>>
}
