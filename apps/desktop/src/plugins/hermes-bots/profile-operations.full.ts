type BotProfileHost = {
  request(method: string, params: Record<string, unknown>): Promise<unknown>
}

function cliExecFailure(result: unknown): string | null {
  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
  const nested = record.result
  const payload = nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : record

  if (payload.blocked) {
    return typeof payload.hint === 'string' && payload.hint ? payload.hint : 'Delete was blocked by the gateway.'
  }

  const code = payload.code
  const output = String(payload.output ?? '')

  if (typeof code === 'number' && code !== 0) {
    return output.trim().slice(-400) || `Delete failed (exit ${code})`
  }

  if (/\bcancelled\b/i.test(output) && !/deleted/i.test(output)) {
    return output.trim().slice(-400) || 'Delete was cancelled.'
  }

  return null
}

export async function deleteBotProfileRequest(host: BotProfileHost, name: string): Promise<void> {
  const result = await host.request('cli.exec', { argv: ['profile', 'delete', '-y', name] })
  const failure = cliExecFailure(result)

  if (failure) {
    throw new Error(failure)
  }
}

export async function updateBotDescription(host: BotProfileHost, name: string, description: string): Promise<void> {
  await host.request('cli.exec', {
    argv: ['profile', 'describe', name, '--text', description]
  })
}
