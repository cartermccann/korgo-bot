type BotProfileHost = {
  request(method: string, params: Record<string, unknown>): Promise<unknown>
}

export async function deleteBotProfileRequest(host: BotProfileHost, name: string): Promise<void> {
  await host.request('profiles.delete', { name })
}

export async function updateBotDescription(host: BotProfileHost, name: string, description: string): Promise<void> {
  await host.request('profiles.configure', { description, name })
}
