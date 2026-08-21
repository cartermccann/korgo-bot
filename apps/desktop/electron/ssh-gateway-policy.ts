import type { GatewayProxyPurpose } from './gateway-proxy'

const MAX_GATEWAY_FRAME_BYTES = 16 * 1024 * 1024
const MAX_PROMPT_CHARS = 1_000_000
const MAX_VOICE_FRAME_BYTES = 64 * 1024
const RESERVED_GATEWAY_PROFILES = new Set(['hermes', 'root', 'sudo', 'test', 'tmp'])

const FORBIDDEN_PARAM_KEY =
  /(?:__proto__|api[_-]?key|billing|constructor|credential|env|oauth|password|prototype|secret|subscription|token)/i

const SAFE_GATEWAY_METHODS = new Set([
  'approval.respond',
  'clarify.respond',
  'commands.catalog',
  'complete.path',
  'complete.slash',
  'llm.oneshot',
  'message.react',
  'model.options',
  'process.kill',
  'process.list',
  'profiles.get_asset',
  'session.activate',
  'session.active_list',
  'session.branch',
  'session.close',
  'session.compress',
  'session.context_breakdown',
  'session.create',
  'session.cwd.set',
  'session.interrupt',
  'session.redirect',
  'session.resume',
  'session.status',
  'session.title',
  'session.usage'
])

const SAFE_METHOD_PARAM_KEYS: Record<string, readonly string[]> = {
  'approval.respond': ['choice', 'request_id', 'session_id'],
  'clarify.respond': ['answer', 'request_id', 'session_id'],
  'commands.catalog': ['session_id'],
  'complete.path': ['cwd', 'session_id', 'word'],
  'complete.slash': ['session_id', 'text'],
  'llm.oneshot': ['input', 'instructions', 'max_tokens', 'session_id', 'task', 'temperature', 'template', 'variables'],
  'message.react': ['author', 'emoji', 'newest_role', 'row_id', 'session_id'],
  'model.options': ['explicit_only', 'refresh', 'session_id'],
  'process.kill': ['process_id', 'session_id'],
  'process.list': ['session_id'],
  'profiles.get_asset': ['asset', 'name'],
  'session.activate': ['cols', 'omit_messages', 'session_id'],
  'session.active_list': [],
  'session.branch': ['count', 'name', 'session_id'],
  'session.close': ['session_id'],
  'session.compress': ['focus_topic', 'session_id'],
  'session.context_breakdown': ['session_id'],
  'session.create': [
    'close_on_disconnect',
    'cols',
    'cwd',
    'fast',
    'messages',
    'model',
    'parent_session_id',
    'profile',
    'provider',
    'reasoning_effort',
    'source',
    'title'
  ],
  'session.cwd.set': ['cwd', 'session_id'],
  'session.interrupt': ['session_id'],
  'session.redirect': ['session_id', 'text'],
  'session.resume': ['cols', 'lazy', 'omit_messages', 'profile', 'session_id', 'source'],
  'session.status': ['session_id'],
  'session.title': ['session_id', 'title'],
  'session.usage': ['session_id']
}

function denied(): never {
  throw new Error('This gateway operation is unavailable in the SSH-only client.')
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

function boundedJson(value: unknown, depth = 0): boolean {
  if (depth > 8) {
    return false
  }

  if (value === null || typeof value === 'boolean') {
    return true
  }

  if (typeof value === 'string') {
    return value.length <= MAX_GATEWAY_FRAME_BYTES
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.length <= 10_000 && value.every(item => boundedJson(item, depth + 1))
  }

  if (!plainRecord(value)) {
    return false
  }

  const entries = Object.entries(value)

  return (
    entries.length <= 256 &&
    entries.every(([key, item]) => key.length <= 128 && !FORBIDDEN_PARAM_KEY.test(key) && boundedJson(item, depth + 1))
  )
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)

  return keys.every(key => allowed.includes(key))
}

function validId(value: unknown): boolean {
  return (
    (typeof value === 'string' && value.length > 0 && value.length <= 256) ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  )
}

function validSessionId(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function validGatewayProfile(value: unknown): boolean {
  return (
    value === 'default' ||
    (typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && !RESERVED_GATEWAY_PROFILES.has(value))
  )
}

function validMiniBotUiMeta(value: unknown): boolean {
  if (!plainRecord(value) || !exactKeys(value, ['chat', 'color', 'created', 'shape', 'title'])) {
    return false
  }

  return (
    (!('chat' in value) || (typeof value.chat === 'string' && value.chat.length <= 256)) &&
    (!('color' in value) || (typeof value.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.color))) &&
    (!('created' in value) || (Number.isSafeInteger(value.created) && Number(value.created) >= 0)) &&
    (!('shape' in value) ||
      (typeof value.shape === 'string' &&
        ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'].includes(value.shape))) &&
    (!('title' in value) || (typeof value.title === 'string' && value.title.length <= 256))
  )
}

function validMiniBotParams(method: string, params: Record<string, unknown>): boolean {
  if (method === 'profiles.list') {
    return (
      exactKeys(params, ['include_sessions']) &&
      (!('include_sessions' in params) || typeof params.include_sessions === 'boolean')
    )
  }

  if (method === 'session.list') {
    return (
      exactKeys(params, ['limit', 'profile']) &&
      validGatewayProfile(params.profile) &&
      Number.isInteger(params.limit) &&
      Number(params.limit) >= 1 &&
      Number(params.limit) <= 100
    )
  }

  if (method === 'profiles.describe' || method === 'profiles.delete') {
    return (
      exactKeys(params, ['name']) &&
      validGatewayProfile(params.name) &&
      (method !== 'profiles.delete' || params.name !== 'default')
    )
  }

  if (method === 'profiles.create') {
    return (
      exactKeys(params, ['clone_from', 'description', 'inherit', 'model', 'name', 'no_skills', 'provider', 'soul']) &&
      validGatewayProfile(params.name) &&
      params.name !== 'default' &&
      (params.clone_from === null || validGatewayProfile(params.clone_from)) &&
      params.inherit === 'none' &&
      (!('description' in params) || (typeof params.description === 'string' && params.description.length <= 2048)) &&
      (!('no_skills' in params) || typeof params.no_skills === 'boolean') &&
      (!('soul' in params) || (typeof params.soul === 'string' && params.soul.length <= 100_000)) &&
      ((!('model' in params) && !('provider' in params)) ||
        (typeof params.model === 'string' &&
          params.model.length <= 256 &&
          typeof params.provider === 'string' &&
          params.provider.length <= 128))
    )
  }

  if (method === 'profiles.configure') {
    const allowed = ['description', 'model', 'name', 'provider', 'soul', 'ui_meta']

    if (!exactKeys(params, allowed) || !validGatewayProfile(params.name)) {
      return false
    }

    if ('description' in params && (typeof params.description !== 'string' || params.description.length > 2048)) {
      return false
    }

    if ('soul' in params && (typeof params.soul !== 'string' || params.soul.length > 100_000)) {
      return false
    }

    if (
      ('model' in params || 'provider' in params) &&
      !(
        typeof params.model === 'string' &&
        params.model.length <= 256 &&
        typeof params.provider === 'string' &&
        params.provider.length <= 128
      )
    ) {
      return false
    }

    if ('ui_meta' in params) {
      if (
        !plainRecord(params.ui_meta) ||
        !exactKeys(params.ui_meta, ['hermes-bots']) ||
        !validMiniBotUiMeta(params.ui_meta['hermes-bots'])
      ) {
        return false
      }
    }

    return true
  }

  if (method === 'profiles.set_asset') {
    return (
      exactKeys(params, ['asset', 'clear', 'data', 'name']) &&
      validGatewayProfile(params.name) &&
      params.asset === 'avatar' &&
      ((params.clear === true && !('data' in params)) ||
        (typeof params.data === 'string' &&
          params.data.length > 0 &&
          params.data.length <= 2_800_000 &&
          !('clear' in params)))
    )
  }

  if (method === 'cron.manage') {
    const action = params.action

    if (action === 'list') {
      return exactKeys(params, ['action', 'include_disabled']) && params.include_disabled === true
    }

    if (action === 'pause' || action === 'remove' || action === 'resume') {
      return (
        exactKeys(params, ['action', 'name']) &&
        typeof params.name === 'string' &&
        params.name.length > 0 &&
        params.name.length <= 256
      )
    }

    return (
      action === 'add' &&
      exactKeys(params, ['action', 'name', 'prompt', 'repeat', 'schedule']) &&
      typeof params.name === 'string' &&
      params.name.length > 0 &&
      params.name.length <= 256 &&
      typeof params.prompt === 'string' &&
      params.prompt.length > 0 &&
      params.prompt.length <= 100_000 &&
      typeof params.schedule === 'string' &&
      params.schedule.length > 0 &&
      params.schedule.length <= 512 &&
      (!('repeat' in params) ||
        (Number.isInteger(params.repeat) && Number(params.repeat) >= 1 && Number(params.repeat) <= 10_000))
    )
  }

  return false
}

function validMiniPath(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || !value.startsWith('/')) {
    return false
  }

  return !Array.from(value).some(character => {
    const code = character.charCodeAt(0)

    return code <= 0x1f || code === 0x7f
  })
}

function validGatewayParams(method: string, params: Record<string, unknown>, linuxMini = false): boolean {
  if (!boundedJson(params)) {
    return false
  }

  if (method === 'prompt.submit') {
    return (
      exactKeys(params, [
        'confirm_empty_truncate',
        'confirm_truncate',
        'interrupted',
        'queued',
        'replace_messages',
        'session_id',
        'surface',
        'text',
        'truncate_before_message_id',
        'truncate_before_row_id',
        'truncate_before_user_ordinal'
      ]) &&
      validSessionId(params.session_id) &&
      typeof params.text === 'string' &&
      params.text.length <= MAX_PROMPT_CHARS
    )
  }

  if (method === 'config.get') {
    return (
      exactKeys(params, ['cwd', 'key', 'session_id']) &&
      ['fast', 'model', 'project', 'reasoning'].includes(String(params.key))
    )
  }

  if (method === 'config.set') {
    if (!exactKeys(params, ['key', 'session_id', 'value']) || !validSessionId(params.session_id)) {
      return false
    }

    const key = String(params.key)
    const value = params.value

    const sessionModel =
      typeof value === 'string' &&
      /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,255} --provider [a-zA-Z0-9][a-zA-Z0-9._-]{0,127} --session$/.test(value)

    return (
      (key === 'fast' && (value === 'fast' || value === 'normal')) ||
      (key === 'reasoning' && typeof value === 'string' && value.length <= 64) ||
      (key === 'model' && sessionModel)
    )
  }

  if (method === 'image.attach_bytes') {
    return (
      exactKeys(params, ['content_base64', 'filename', 'session_id']) &&
      validSessionId(params.session_id) &&
      typeof params.content_base64 === 'string' &&
      typeof params.filename === 'string' &&
      params.filename.length <= 512
    )
  }

  if (method === 'file.attach') {
    return (
      exactKeys(params, ['data_url', 'name', 'path', 'session_id']) &&
      validSessionId(params.session_id) &&
      typeof params.data_url === 'string' &&
      typeof params.name === 'string' &&
      params.name.length <= 512 &&
      params.path === ''
    )
  }

  if (linuxMini && validMiniBotParams(method, params)) {
    return true
  }

  if (!SAFE_GATEWAY_METHODS.has(method) || !exactKeys(params, SAFE_METHOD_PARAM_KEYS[method] || [])) {
    return false
  }

  if (
    (method.startsWith('session.') && method !== 'session.active_list' && method !== 'session.create') ||
    method.startsWith('process.')
  ) {
    if (!validSessionId(params.session_id)) {
      return false
    }
  }

  if (method === 'commands.catalog') {
    return !('session_id' in params) || validSessionId(params.session_id)
  }

  if (method === 'approval.respond') {
    return validSessionId(params.session_id) && (params.choice === 'once' || params.choice === 'deny')
  }

  if (method === 'session.create') {
    return params.source === 'desktop' && (!('profile' in params) || validGatewayProfile(params.profile))
  }

  if (method === 'session.resume') {
    return params.source === 'desktop' && (!('profile' in params) || validGatewayProfile(params.profile))
  }

  if (method === 'complete.path') {
    if (!validSessionId(params.session_id) || 'cwd' in params || typeof params.word !== 'string') {
      return false
    }

    const match = /^@(file|folder):(.*)$/.exec(params.word)

    if (!match || match[2].length > 4096 || match[2].startsWith('/') || match[2].startsWith('~')) {
      return false
    }

    return !match[2].split('/').some(segment => segment === '..')
  }

  if (method === 'session.compress') {
    return (
      !('focus_topic' in params) ||
      (typeof params.focus_topic === 'string' && params.focus_topic.length > 0 && params.focus_topic.length <= 4096)
    )
  }

  if (method === 'session.cwd.set') {
    return validMiniPath(params.cwd)
  }

  if (method === 'session.redirect') {
    return typeof params.text === 'string' && params.text.length > 0 && params.text.length <= MAX_PROMPT_CHARS
  }

  if (method === 'session.title' && 'title' in params) {
    return typeof params.title === 'string' && params.title.length > 0 && params.title.length <= 512
  }

  if (method === 'profiles.get_asset') {
    return (
      params.asset === 'avatar' &&
      typeof params.name === 'string' &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(params.name)
    )
  }

  if (method === 'model.options') {
    return params.explicit_only === true && !('refresh' in params)
  }

  return true
}

function assertGatewayFrame(data: unknown, linuxMini = false): void {
  if (typeof data !== 'string' || data.length === 0 || data.length > MAX_GATEWAY_FRAME_BYTES) {
    return denied()
  }

  let frame: unknown

  try {
    frame = JSON.parse(data)
  } catch {
    return denied()
  }

  if (!plainRecord(frame) || !exactKeys(frame, ['id', 'jsonrpc', 'method', 'params'])) {
    return denied()
  }

  if (frame.jsonrpc !== '2.0' || !validId(frame.id) || typeof frame.method !== 'string' || !plainRecord(frame.params)) {
    return denied()
  }

  if (!validGatewayParams(frame.method, frame.params, linuxMini)) {
    return denied()
  }
}

function assertVoiceFrame(data: unknown): void {
  if (typeof data !== 'string' || data.length === 0 || data.length > MAX_VOICE_FRAME_BYTES) {
    return denied()
  }

  let frame: unknown

  try {
    frame = JSON.parse(data)
  } catch {
    return denied()
  }

  if (!plainRecord(frame)) {
    return denied()
  }

  if (exactKeys(frame, ['text']) && typeof frame.text === 'string' && frame.text.length > 0) {
    return
  }

  if (exactKeys(frame, ['done']) && frame.done === true) {
    return
  }

  return denied()
}

export function assertSshOnlyGatewayProxyDataAllowed(
  purpose: GatewayProxyPurpose,
  data: unknown,
  linuxMini = false
): void {
  if (purpose === 'gateway') {
    return assertGatewayFrame(data, linuxMini)
  }

  if (purpose === 'voice') {
    return assertVoiceFrame(data)
  }

  return denied()
}
