export const MINI_REMOTE_HERMES_PATH = '/usr/local/bin/hermes-korgo'
export const MINI_REMOTE_HERMES_HOME = '/state/hermes'

const SAFE_PATH_RE = /^\/[A-Za-z0-9._/+:-]+$/

export function parseMiniRuntimeContract(raw: unknown): {
  remoteHermesHome: string
  remoteLockDir: string
} {
  const values = new Map<string, string>()

  for (const line of String(raw || '')
    .trim()
    .split(/\r?\n/)) {
    const match = /^(lock_dir|hermes_home)=(.+)$/.exec(line)

    if (!match || values.has(match[1])) {
      throw new Error('The Mini runtime returned an invalid desktop contract.')
    }

    values.set(match[1], match[2])
  }

  const remoteLockDir = values.get('lock_dir') || ''
  const remoteHermesHome = values.get('hermes_home') || ''

  if (
    values.size !== 2 ||
    remoteHermesHome !== MINI_REMOTE_HERMES_HOME ||
    !SAFE_PATH_RE.test(remoteLockDir) ||
    remoteLockDir.includes('//') ||
    remoteLockDir.includes('/../') ||
    remoteLockDir.includes('/./') ||
    !remoteLockDir.endsWith('/tenant/home/.hermes/desktop-ssh')
  ) {
    throw new Error('The Mini runtime returned an unsafe desktop contract.')
  }

  return { remoteHermesHome, remoteLockDir }
}
