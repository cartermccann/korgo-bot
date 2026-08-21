import { IPC_CHANNEL_POLICY as SSH_CHANNELS } from './ipc-channel-policy.ssh-only'
import type { IpcChannelPolicy } from './ipc-policy'

const primaryGatewayRule = Object.freeze({
  capabilities: Object.freeze(['primary'] as const),
  kind: 'handle' as const,
  privilege: 'gateway-runtime' as const
})

const primaryGatewayEventRule = Object.freeze({
  capabilities: Object.freeze(['primary'] as const),
  kind: 'on' as const,
  privilege: 'gateway-runtime' as const
})

export const IPC_CHANNEL_POLICY = Object.freeze({
  ...SSH_CHANNELS,
  'hermes:mini-desktop:start': primaryGatewayRule,
  'hermes:mini-desktop:send': primaryGatewayEventRule,
  'hermes:mini-desktop:ack': primaryGatewayEventRule,
  'hermes:mini-desktop:close': primaryGatewayEventRule
}) satisfies IpcChannelPolicy
