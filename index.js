/**
 * dsh-desktop-notifier — bottom-right desktop popups for DeepSeek Harness.
 *
 * Capabilities, both rendered by `scripts/popup.ps1` (WPF, Windows PowerShell 5.1):
 *   1. A card when an agent turn finishes, and a card when a step fails.
 *   2. A choice card when an agent calls `ask_user_question`: the options become
 *      native buttons and a click answers the tool call directly. Dismissing,
 *      timing out, or failing to render falls through (`next()`) to the regular
 *      Web UI answerer.
 *
 * The only third-party import is `@deepseek-ai/schemastery`, which DSH itself
 * resolves inside the profile; every option is declared `volatile()` so the
 * Settings page (lib/client.js) can edit it live without reloading the plugin.
 */

import z from '@deepseek-ai/schemastery'

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveThemePreference } from './lib/theme.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const POPUP_SCRIPT = path.join(HERE, 'scripts', 'popup.ps1')
const FOCUS_SCRIPT = path.join(HERE, 'scripts', 'focus-window.ps1')
/** Plays one sound and prints `{action:"played"}`: used by the Settings preview. */
const SOUND_SCRIPT = path.join(HERE, 'scripts', 'preview-sound.ps1')

const POWERSHELL = 'powershell.exe'

const DEFAULTS = {
  enabled: true,
  notifyOnTurnEnd: true,
  notifyOnError: true,
  /**
   * When to notify: 'always', or 'unfocused' (only while the DSH window is not
   * in the foreground — the renderer probes the foreground window for this).
   */
  notifyWhen: 'always',
  minTurnMs: 5000,
  infoTimeoutMs: 12000,
  answerQuestions: true,
  questionTimeoutMs: 60000,
  maxBodyChars: 260,
  /**
   * Card appearance: 'auto' follows the DSH appearance setting (light / dark /
   * follow Windows), 'light' and 'dark' force one, 'system' always follows the
   * Windows app theme and ignores DSH's own setting.
   */
  theme: 'auto',
  /** One entry of SOUNDS; 'none' keeps the card silent. */
  sound: 'default',
  focusOnOpen: true,
  /**
   * Approval requests: 'unfocused' shows the allow/deny card only while the DSH
   * window is in the background (a focused window already has the in-app
   * composer), 'always' shows it either way, 'off' leaves approvals to the Web UI.
   */
  answerApprovals: 'unfocused',
  /** How long the approval card waits before the in-app card takes over. */
  approvalTimeoutMs: 120000,
  /** Optional .wav path played instead of the preset chosen in `sound`. */
  soundFile: '',
  locale: 'zh',
  /** Append every decision to `%TEMP%\dsh-desktop-notifier-state.json`. */
  diagnostics: true,
  /** Advanced/testing: alternate renderer script that speaks the same protocol. */
  popupScript: '',
}

/** Playable sounds. `default` picks by card kind inside the renderer. */
export const SOUNDS = [
  'none',
  'default',
  'notify',
  'ding',
  'chimes',
  'tada',
  'question',
  'asterisk',
  'exclamation',
  'critical',
  'email',
  'calendar',
  'messaging',
  'nudge',
  'reminder',
]

/**
 * Plugin config. Every field is `volatile()`: the Settings page writes them
 * through the DSH settings service and this plugin reads the live value on each
 * event, so a change applies to the very next popup.
 */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULTS.enabled).volatile(),
  notifyOnTurnEnd: z.boolean().default(DEFAULTS.notifyOnTurnEnd).volatile(),
  notifyOnError: z.boolean().default(DEFAULTS.notifyOnError).volatile(),
  notifyWhen: z.union(['always', 'unfocused']).default(DEFAULTS.notifyWhen).volatile(),
  minTurnMs: z.number().min(0).max(600000).default(DEFAULTS.minTurnMs).volatile(),
  infoTimeoutMs: z.number().min(0).max(600000).default(DEFAULTS.infoTimeoutMs).volatile(),
  answerQuestions: z.boolean().default(DEFAULTS.answerQuestions).volatile(),
  questionTimeoutMs: z.number().min(0).max(3600000).default(DEFAULTS.questionTimeoutMs).volatile(),
  maxBodyChars: z.number().min(20).max(4000).default(DEFAULTS.maxBodyChars).volatile(),
  theme: z.union(['auto', 'light', 'dark', 'system']).default(DEFAULTS.theme).volatile(),
  sound: z.union([...SOUNDS, true, false]).default(DEFAULTS.sound).volatile(),
  focusOnOpen: z.boolean().default(DEFAULTS.focusOnOpen).volatile(),
  answerApprovals: z.union(['unfocused', 'always', 'off']).default(DEFAULTS.answerApprovals).volatile(),
  approvalTimeoutMs: z.number().min(0).max(3600000).default(DEFAULTS.approvalTimeoutMs).volatile(),
  soundFile: z.string().default(DEFAULTS.soundFile).volatile(),
  locale: z.union(['zh', 'en']).default(DEFAULTS.locale).volatile(),
  diagnostics: z.boolean().default(DEFAULTS.diagnostics).volatile(),
  popupScript: z.string().default(DEFAULTS.popupScript),
})

/**
 * Current value of one option. Volatile fields arrive as `{ get() }` accessors
 * from the Loader (so the settings service can swap the value underneath us);
 * plain objects (tests, direct calls) are read as-is.
 */
function live(cfg, key) {
  const raw = cfg?.[key]
  if (raw !== null && typeof raw === 'object' && typeof raw.get === 'function') return raw.get()
  if (raw === undefined) return DEFAULTS[key]
  return raw
}

const FALLBACK_TEXT = {
  zh: {
    turnDone: '本轮工作完成',
    turnDoneEmpty: '（本轮没有文本输出）',
    error: '执行出错',
    question: '需要你的决定',
    open: '查看',
    close: '关闭',
    waiting: '等待你的选择',
    customPlaceholder: '输入自定义回答…',
    send: '发送',
    approvalTitle: '需要你的授权',
    approvalWaiting: '等待你的授权',
    allow: '允许一次',
    deny: '拒绝',
    testTitle: '测试通知',
    testBody: '如果你看到这张卡片，说明桌面通知已经接好了。',
    testQuestionBody: '这是一张测试选择卡：选一项，或者直接输入你的回答。',
    testOptions: ['选项一', '选项二', '选项三'],
    testApprovalBody: 'bash — 测试：请求执行一条需要授权的命令',
    usedMs: (s) => `用时 ${s}s`,
  },
  en: {
    turnDone: 'Turn finished',
    turnDoneEmpty: '(no text output this turn)',
    error: 'Step failed',
    question: 'Your decision is needed',
    open: 'Open',
    close: 'Close',
    waiting: 'waiting for your choice',
    customPlaceholder: 'Type your own answer…',
    send: 'Send',
    approvalTitle: 'Permission needed',
    approvalWaiting: 'waiting for your decision',
    allow: 'Allow once',
    deny: 'Deny',
    testTitle: 'Test notification',
    testBody: 'If you can see this card, desktop notifications are wired up.',
    usedMs: (s) => `${s}s`,
  },
}

/** Popup copy from `locale/<locale>.json` (display metadata lives there too). */
function loadLocaleText(locale) {
  try {
    const file = path.join(HERE, 'locale', `${locale}.json`)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const popup = parsed && typeof parsed === 'object' ? parsed.popup : undefined
    return popup && typeof popup === 'object' ? popup : null
  } catch {
    return null
  }
}

/**
 * Long-poll answer for `GET /desktop-notifier/navigate?since=<nonce>&wait=<ms>`:
 * reply immediately when a newer hand-off exists, otherwise hold the response
 * until one arrives or the wait elapses (`nonce: 0` means "nothing new"). A page
 * that was asleep simply asks again with its last nonce.
 */
function serveNavigation(req, res, state, waiters) {
  const send = (body) => {
    if (res.writableEnded) return
    try {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(body))
    } catch {
      /* the page went away between read and write */
    }
  }
  let since = 0
  let waitMs = 0
  let probe = false
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    since = Number(url.searchParams.get('since') ?? 0) || 0
    waitMs = Math.min(30000, Math.max(0, Number(url.searchParams.get('wait') ?? 0) || 0))
    // `probe=1` (only used by manual checks) also reports request counters, so a
    // live page's polling can be told apart from the probe's own request.
    probe = url.searchParams.get('probe') === '1'
  } catch {
    /* a malformed URL is answered as "nothing new" */
  }
  state.polls = (state.polls ?? 0) + 1
  const withStats = (body) => (probe ? { ...body, polls: state.polls, waiters: waiters.size } : body)
  if (state.nonce > since) {
    send(withStats({ nonce: state.nonce, sessionId: state.sessionId }))
    return
  }
  if (waitMs === 0) {
    send(withStats({ nonce: 0 }))
    return
  }
  let settled = false
  const finish = (body) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    waiters.delete(onUpdate)
    res.removeListener('close', onClose)
    send(withStats(body))
  }
  const onUpdate = (update) => finish(update)
  const onClose = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    waiters.delete(onUpdate)
  }
  const timer = setTimeout(() => finish({ nonce: 0 }), waitMs)
  timer.unref?.()
  waiters.add(onUpdate)
  res.on('close', onClose)
}

/** Read a small JSON request body (the browser half's progress reports). */
async function readJsonBody(req, limit = 8192) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) return null
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

/**
 * `POST /desktop-notifier/navigate` — the browser half reporting how far it got,
 * so a failed "查看" hand-off leaves a trace in the diagnostics file instead of
 * failing silently inside the renderer.
 */
async function serveHandOffReport(req, res, report) {
  const body = await readJsonBody(req)
  const reply = (status, payload) => {
    if (res.writableEnded) return
    try {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(payload))
    } catch {
      /* the page went away between read and write */
    }
  }
  if (!body || typeof body !== 'object') {
    reply(400, { ok: false })
    return
  }
  try {
    report({
      phase: String(body.phase ?? 'unknown').slice(0, 40),
      sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 120) : null,
      message: typeof body.message === 'string' ? body.message.slice(0, 300) : null,
    })
  } catch {
    /* diagnostics are best effort */
  }
  reply(200, { ok: true })
}

function log(ctx, level, text) {
  try {
    const logger = ctx.logger
    const fn = logger && typeof logger[level] === 'function' ? logger[level].bind(logger) : null
    if (fn) fn(`desktop-notifier: ${text}`)
  } catch {
    /* logging must never break a turn */
  }
}

/** Rolling diagnostics: what the plugin saw and did, readable while it runs. */
const STATE_FILE = path.join(tmpdir(), 'dsh-desktop-notifier-state.json')
/** Diagnostics: the composed browser module graph, to verify the client half. */
const CLIENT_GRAPH_FILE = path.join(tmpdir(), 'dsh-desktop-notifier-clientgraph.json')
/**
 * Long-poll route the browser half reads to learn which session a clicked
 * "查看" card wants. It is served straight by `ctx.webServer`, so both the
 * Electron window (`dsh-app://app/...` is forwarded to the Host listener) and a
 * plain browser tab can reach it.
 */
const NAV_ROUTE = '/desktop-notifier/navigate'
/** Settings-page side channel: render a sample card / play the chosen sound. */
const TEST_ROUTE = '/desktop-notifier/action'
const recent = []

function noteState(enabled, entry) {
  if (!enabled) return
  try {
    recent.push({ at: new Date().toISOString(), ...entry })
    while (recent.length > 40) recent.shift()
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), events: recent }, null, 2),
      'utf8',
    )
  } catch {
    /* diagnostics are best effort */
  }
}

/** Visible text of a message `content` block array. */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

function squash(text, maxChars) {
  const clean = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (clean.length <= maxChars) return clean
  return `${clean.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

function clockText(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function sessionHeader(agent) {
  try {
    return agent?.session?.header ?? null
  } catch {
    return null
  }
}

function sessionIdOf(agent) {
  return sessionHeader(agent)?.id ?? agent?.id ?? null
}

/** Workspace folder name, used as the card's context label. */
function workspaceLabel(agent) {
  const header = sessionHeader(agent)
  const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
  if (!cwd) return ''
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return base ?? ''
}

/** True for the user's own sessions, false for spawned subagents. */
function isUserSession(agent) {
  const header = sessionHeader(agent)
  if (!header) return false
  if (header.origin === 'subagent') return false
  if (header.parentSession) return false
  return true
}

/**
 * Run one popup invocation and resolve with its single JSON result line.
 * Never rejects: every failure becomes `{ action: 'error' }` so callers can
 * fall back to the Web UI.
 */
function runPopup(payload, { onChild, timeoutGraceMs = 20000, script = POPUP_SCRIPT } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ action: 'unsupported' })
      return
    }
    let dir
    let payloadFile
    try {
      dir = mkdtempSync(path.join(tmpdir(), 'dsh-notifier-'))
      payloadFile = path.join(dir, 'payload.json')
      writeFileSync(payloadFile, JSON.stringify(payload), 'utf8')
    } catch (error) {
      resolve({ action: 'error', error: String(error) })
      return
    }
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-WindowStyle',
      'Hidden',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-PayloadFile',
      payloadFile,
    ]
    let child
    try {
      child = spawn(POWERSHELL, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ action: 'error', error: String(error) })
      return
    }
    if (typeof onChild === 'function') onChild(child)
    let stdout = ''
    let stderr = ''
    let settled = false
    let guard = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (guard !== null) clearTimeout(guard)
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* temp cleanup is best effort */
      }
      resolve(result)
    }
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => finish({ action: 'error', error: String(error) }))
    child.on('close', (code) => {
      const lines = stdout.replace(/^\uFEFF/, '').split(/\r?\n/)
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim()
        if (!line.startsWith('{')) continue
        try {
          const parsed = JSON.parse(line)
          if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string') {
            finish(parsed)
            return
          }
        } catch {
          /* not the result line */
        }
      }
      finish({ action: code === 0 ? 'dismissed' : 'error', code, stderr: stderr.slice(-400) })
    })
    const timeoutMs = Number(payload.timeoutMs) > 0 ? Number(payload.timeoutMs) : 0
    if (timeoutMs > 0) {
      guard = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* already gone */
        }
        finish({ action: 'timeout' })
      }, timeoutMs + timeoutGraceMs)
      guard.unref?.()
    }
  })
}

/** Bring the DeepSeek Harness main window to the foreground. */
function focusHarness(ctx) {
  if (process.platform !== 'win32') return
  try {
    const child = spawn(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', FOCUS_SCRIPT],
      { windowsHide: true, stdio: 'ignore', detached: true },
    )
    child.on('error', () => {})
    child.unref()
  } catch (error) {
    log(ctx, 'warn', `focus failed: ${String(error)}`)
  }
}

/**
 * Theme handed to the renderer: a concrete name, or 'system' (the renderer then
 * reads the Windows app theme itself, which covers "follow the system").
 *
 * `auto` — the default — follows the appearance setting of the hosting DSH
 * profile, so the card matches the app window.
 *
 * @param {'auto' | 'light' | 'dark' | 'system'} configured
 * @returns {'light' | 'dark' | 'system'}
 */
function resolveTheme(configured) {
  return resolveThemePreference(configured, HERE)
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  /** Live option read: volatile fields change while the plugin runs. */
  const get = (key) => live(cfg, key)
  const note = (entry) => noteState(Boolean(get('diagnostics')), entry)
  const locale = typeof get('locale') === 'string' ? get('locale') : 'zh'
  const t = {
    ...(FALLBACK_TEXT[locale] ?? FALLBACK_TEXT.zh),
    ...(loadLocaleText(locale) ?? {}),
  }
  if (!get('enabled')) {
    log(ctx, 'info', 'disabled by config')
    return
  }
  if (process.platform !== 'win32') {
    log(ctx, 'info', `platform ${process.platform} is not supported; staying idle`)
    return
  }

  // This plugin ships its own Settings page (lib/client.js), so it opts out of
  // the auto-generated form; the entry's config is still read and written.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (child) => {
      if (!child.settings || typeof child.settings.configure !== 'function') return
      child.effect(
        () => child.settings.configure({ auto: false }, child.fiber),
        'dsh-desktop-notifier: own settings page',
      )
    })
  }

  // Diagnostics: report whether this package's client half reached the browser
  // module graph, so the Settings page can be verified without guesswork.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['clientModules'], (child) => {
      const modules = child.clientModules
      if (!modules || typeof modules.graph !== 'function') return
      const record = () => {
        if (!get('diagnostics')) return
        try {
          const graph = modules.graph()
          const entries = Array.isArray(graph?.entries) ? graph.entries : []
          const ids = entries.map((entry) => entry?.id).filter((id) => typeof id === 'string')
          writeFileSync(
            CLIENT_GRAPH_FILE,
            JSON.stringify(
              {
                at: new Date().toISOString(),
                rev: graph?.rev ?? null,
                release: graph?.release ?? null,
                count: ids.length,
                ids,
                own: ids.includes('dsh-desktop-notifier'),
                clientPath: modules.clientPath('dsh-desktop-notifier') ?? null,
              },
              null,
              2,
            ),
          )
        } catch (error) {
          try {
            writeFileSync(CLIENT_GRAPH_FILE, JSON.stringify({ error: String(error) }))
          } catch {
            /* diagnostics are best effort */
          }
        }
      }
      record()
      ctx.effect(
        () => (typeof modules.onGraphChanged === 'function' ? modules.onGraphChanged(record) : undefined),
        'dsh-desktop-notifier: client graph diagnostics',
      )
    })
  }

  // ── session hand-off: the card lives outside the page ────────────────────
  // "查看" is clicked in the PowerShell popup, so the Host publishes the wanted
  // session on a long-poll route; the browser half (lib/client.js) switches the
  // main view through `uiWorkspace.openSession` — the same call the chat pane
  // uses for its own session links.
  const navigation = { nonce: 0, sessionId: null, at: 0 }
  const navWaiters = new Set()
  function publishNavigation(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    navigation.nonce += 1
    navigation.sessionId = sessionId
    navigation.at = Date.now()
    const update = { nonce: navigation.nonce, sessionId }
    for (const waiter of [...navWaiters]) {
      try {
        waiter(update)
      } catch {
        /* one broken response must not drop the others */
      }
    }
    note({ kind: 'navigate-published', id: sessionId, nonce: navigation.nonce })
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (child) => {
      const server = child.webServer
      if (!server || typeof server.register !== 'function') return
      child.effect(
        () =>
          server.register({
            kind: 'exact',
            path: NAV_ROUTE,
            handler: (req, res) => {
              // POST = the browser half reporting its progress on a hand-off.
              if (req.method === 'POST') {
                void serveHandOffReport(req, res, (report) => note({ kind: 'hand-off-report', ...report }))
                return
              }
              serveNavigation(req, res, navigation, navWaiters)
            },
          }),
        'dsh-desktop-notifier: session hand-off route',
      )
      // Settings page: "测试通知" and "试听提示音" buttons land here.
      child.effect(
        () =>
          server.register({
            kind: 'exact',
            path: TEST_ROUTE,
            handler: (req, res) => {
              void serveAction(req, res)
            },
          }),
        'dsh-desktop-notifier: settings action route',
      )
    })
  }

  /** Live child processes, so plugin reload cannot leave orphan popups. */
  const children = new Set()
  ctx.effect(() => () => {
    for (const child of children) {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }
    children.clear()
  })

  const trackChild = (child) => {
    children.add(child)
    child.on('close', () => children.delete(child))
  }

  /** Per-session turn bookkeeping, keyed by session id. */
  const sessions = new Map()
  const stateOf = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      state = { lastUserAt: 0, lastText: '', notifiedTurn: 0, turnSeq: 0 }
      sessions.set(id, state)
    }
    return state
  }

  /** Popup stacking: at most two informative cards are visible at once. */
  let activePopups = 0
  const rendererScript =
    typeof get('popupScript') === 'string' && get('popupScript').length > 0 ? get('popupScript') : POPUP_SCRIPT
  async function show(payload, { blocking = false, onChild } = {}) {
    if (!blocking && activePopups >= 2) return { action: 'skipped' }
    const slot = Math.min(activePopups, 2)
    activePopups += 1
    try {
      const result = await runPopup(
        {
          ...payload,
          slot,
          theme: resolveTheme(get('theme')),
          // A card may override the global timing / sound (the approval card only
          // interrupts while the app is unfocused, the preview plays one sound).
          notifyWhen: payload.notifyWhen ?? get('notifyWhen'),
          sound: payload.sound ?? get('sound'),
          soundFile: payload.soundFile ?? get('soundFile'),
        },
        { onChild: typeof onChild === 'function' ? onChild : trackChild, script: rendererScript },
      )
      if (result.action === 'error') {
        log(ctx, 'warn', `popup failed: ${result.error ?? result.stderr ?? 'unknown'}`)
      }
      return result
    } finally {
      activePopups = Math.max(0, activePopups - 1)
    }
  }

  // ── 1c. permission requests: allow once / deny, answered from the desktop ──
  // `approval/request` is a waterfall: the first listener that returns an outcome
  // answers the request, while returning nothing (or calling `next()`) hands it to
  // the next answerer, which is the Web UI card. This listener is prepended, but
  // it only answers when its own card actually came back with a decision — a
  // focused window, a skipped card, an abort or a timeout all delegate, so the
  // in-app card keeps working exactly as before.
  const approvalMode = () => {
    const value = get('answerApprovals')
    return value === 'always' || value === 'off' ? value : 'unfocused'
  }

  async function askApproval(request) {
    const toolName = typeof request?.toolName === 'string' && request.toolName ? request.toolName : 'tool'
    const rawReason =
      typeof request?.reason === 'string' && request.reason.trim()
        ? request.reason.trim()
        : typeof request?.displayReason === 'string'
          ? request.displayReason.trim()
          : ''
    const body = rawReason
      ? `${toolName} — ${squash(rawReason, Number(get('maxBodyChars')))}`
      : toolName
    const payload = {
      kind: 'approval',
      icon: '🔐',
      title: t.approvalTitle,
      body,
      meta: [workspaceLabel(request?.agent), t.approvalWaiting].filter(Boolean).join(' · '),
      accent: '#d97706',
      actions: [
        { id: 'allow', label: t.allow, primary: true },
        { id: 'deny', label: t.deny },
      ],
      timeoutMs: Number(get('approvalTimeoutMs')),
      // A focused window already shows the in-app card, so the desktop card is
      // only wanted there when the user asked for it explicitly.
      notifyWhen: approvalMode() === 'unfocused' ? 'unfocused' : 'always',
    }
    let child = null
    const onAbort = () => {
      try {
        child?.kill()
      } catch {
        /* the renderer is already gone */
      }
    }
    try {
      request?.signal?.addEventListener?.('abort', onAbort)
    } catch {
      /* no abort signal on older hosts */
    }
    try {
      const result = await show(payload, {
        onChild: (proc) => {
          child = proc
          trackChild(proc)
        },
      })
      if (result.action === 'allow') {
        note({ kind: 'approval-card', outcome: 'allowed-once' })
        return 'allowed-once'
      }
      if (result.action === 'deny') {
        note({ kind: 'approval-card', outcome: 'rejected' })
        return 'rejected'
      }
      note({ kind: 'approval-card', outcome: 'delegated', action: result.action })
      return undefined
    } finally {
      try {
        request?.signal?.removeEventListener?.('abort', onAbort)
      } catch {
        /* nothing to clean up */
      }
    }
  }

  ctx.on(
    'approval/request',
    async (request, next) => {
      if (approvalMode() !== 'off') {
        try {
          const outcome = await askApproval(request)
          if (outcome) return outcome
        } catch (error) {
          log(ctx, 'warn', `approval card failed: ${String(error)}`)
        }
      }
      return typeof next === 'function' ? next() : undefined
    },
    { prepend: true },
  )

  // ── settings page: render a sample card / play the chosen sound ───────────
  function sampleCard(kind) {
    const meta = [workspaceLabel(), clockText()].filter(Boolean).join(' · ')
    if (kind === 'question') {
      return {
        kind: 'question',
        icon: '❓',
        title: t.question,
        body: t.testQuestionBody,
        meta,
        accent: '#f59e0b',
        allowCustom: true,
        customPlaceholder: t.customPlaceholder,
        sendLabel: t.send,
        actions: t.testOptions.map((label, index) => ({ id: `opt-${index}`, label, primary: index === 0 })),
        timeoutMs: Number(get('questionTimeoutMs')),
        width: 424,
      }
    }
    if (kind === 'approval') {
      return {
        kind: 'approval',
        icon: '🔐',
        title: t.approvalTitle,
        body: t.testApprovalBody,
        meta: [workspaceLabel(), t.approvalWaiting].filter(Boolean).join(' · '),
        accent: '#d97706',
        actions: [
          { id: 'allow', label: t.allow, primary: true },
          { id: 'deny', label: t.deny },
        ],
        timeoutMs: Number(get('approvalTimeoutMs')),
      }
    }
    return {
      kind: 'info',
      icon: '🔔',
      title: t.testTitle,
      body: t.testBody,
      meta,
      accent: '#4176e6',
      actions: [
        { id: 'open', label: t.open, primary: true },
        { id: 'close', label: t.close },
      ],
      timeoutMs: Number(get('infoTimeoutMs')),
      focusOnOpen: Boolean(get('focusOnOpen')),
    }
  }

  /** Play the configured sound once — the Settings "试听" button. */
  function previewSound() {
    return new Promise((resolve) => {
      let dir
      let payloadFile
      try {
        dir = mkdtempSync(path.join(tmpdir(), 'dsh-notifier-sound-'))
        payloadFile = path.join(dir, 'payload.json')
        writeFileSync(payloadFile, JSON.stringify({ sound: get('sound'), soundFile: get('soundFile') }), 'utf8')
      } catch (error) {
        resolve({ action: 'error', error: String(error) })
        return
      }
      const args = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SOUND_SCRIPT,
        '-PayloadFile',
        payloadFile,
      ]
      let child
      try {
        child = spawn(POWERSHELL, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        resolve({ action: 'error', error: String(error) })
        return
      }
      let stdout = ''
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.on('error', (error) => resolve({ action: 'error', error: String(error) }))
      child.on('close', () => {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* best effort */
        }
        try {
          resolve(JSON.parse(stdout.trim().split('\n').pop()))
        } catch {
          resolve({ action: 'played' })
        }
      })
    })
  }

  async function serveAction(req, res) {
    const reply = (status, payload) => {
      if (res.writableEnded) return
      try {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(payload))
      } catch {
        /* the page went away between read and write */
      }
    }
    if (req.method !== 'POST') {
      reply(405, { ok: false, error: 'POST only' })
      return
    }
    const body = await readJsonBody(req)
    if (!body || typeof body !== 'object') {
      reply(400, { ok: false })
      return
    }
    const action = typeof body.action === 'string' ? body.action : ''
    try {
      if (action === 'test-card') {
        const kind = body.kind === 'question' || body.kind === 'approval' ? body.kind : 'info'
        const result = await show(sampleCard(kind))
        note({ kind: 'test-card', card: kind, action: result.action })
        reply(200, { ok: result.action !== 'error', card: kind, action: result.action })
        return
      }
      if (action === 'preview-sound') {
        const result = await previewSound()
        note({ kind: 'preview-sound', sound: get('sound'), soundFile: get('soundFile'), action: result.action })
        reply(200, { ok: result.action !== 'error', action: result.action })
        return
      }
      reply(400, { ok: false, error: 'unknown action' })
    } catch (error) {
      reply(500, { ok: false, error: String(error).slice(0, 300) })
    }
  }

  // ── session side channel: prompt time + last assistant text ───────────────
  ctx.on('session/event', (session, event) => {
    const id = session?.id
    if (typeof id !== 'string') return
    const state = stateOf(id)
    if (event?.type === 'user/message') {
      state.lastUserAt = typeof event.time === 'number' ? event.time : Date.now()
      state.lastText = ''
      return
    }
    if (event?.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content)
      if (text) state.lastText = text
    }
  })

  // ── 1a. turn finished ────────────────────────────────────────────────────
  ctx.on('agent/turn-stopping', ({ agent }) => {
    const notifyOnTurnEnd = Boolean(get('notifyOnTurnEnd'))
    if (!notifyOnTurnEnd || !agent || !isUserSession(agent)) {
      note({ kind: 'turn-stopping-ignored', reason: !notifyOnTurnEnd ? 'config' : agent ? 'subagent-session' : 'no-agent' })
      return
    }
    const id = sessionIdOf(agent)
    if (typeof id !== 'string') {
      note({ kind: 'turn-stopping-ignored', reason: 'no-session-id' })
      return
    }
    const state = stateOf(id)
    state.turnSeq += 1
    const elapsed = state.lastUserAt > 0 ? Date.now() - state.lastUserAt : 0
    const minTurnMs = Number(get('minTurnMs'))
    if (elapsed > 0 && elapsed < minTurnMs) {
      note({ kind: 'turn-stopping-ignored', reason: 'below-minTurnMs', id, elapsed })
      return
    }
    const body = squash(state.lastText, Number(get('maxBodyChars'))) || t.turnDoneEmpty
    const metaParts = [workspaceLabel(agent), clockText(), elapsed > 0 ? t.usedMs((elapsed / 1000).toFixed(1)) : '']
    const payload = {
      kind: 'info',
      icon: '✅',
      title: t.turnDone,
      body,
      meta: metaParts.filter(Boolean).join(' · '),
      accent: '#4176e6',
      actions: [
        { id: 'open', label: t.open, primary: true },
        { id: 'close', label: t.close },
      ],
      timeoutMs: Number(get('infoTimeoutMs')),
      focusOnOpen: Boolean(get('focusOnOpen')),
    }
    note({ kind: 'turn-card', id, elapsed, chars: body.length, notifyWhen: get('notifyWhen'), sound: get('sound') })
    void show(payload).then((result) => {
      note({ kind: 'turn-card-closed', id, action: result.action, focused: result.focused })
      if (result.action === 'open') {
        // Publish before raising the window: the page is usually throttled while
        // hidden, and bringing it forward wakes the poll that consumes this.
        publishNavigation(id)
        // The renderer raises the window itself right after it closes the card;
        // this is only the fallback for builds that cannot do it.
        if (get('focusOnOpen') && result.focused !== true) {
          note({ kind: 'focus-fallback', focused: false })
          focusHarness(ctx)
        }
      }
    })
  })

  // ── 1b. step failed ──────────────────────────────────────────────────────
  ctx.on('agent/error', ({ agent, error }) => {
    if (!get('notifyOnError') || !agent || !isUserSession(agent)) return
    const message = error instanceof Error ? error.message : String(error ?? 'unknown error')
    const payload = {
      kind: 'info',
      icon: '⚠️',
      title: t.error,
      body: squash(message, Number(get('maxBodyChars'))),
      meta: workspaceLabel(agent),
      accent: '#ec1313',
      actions: [{ id: 'close', label: t.close, primary: true }],
      timeoutMs: Math.max(6000, Number(get('infoTimeoutMs'))),
    }
    void show(payload)
    note({ kind: 'error-card', message: squash(message, 120) })
  })

  // ── 2. choice card for ask_user_question ─────────────────────────────────
  let questionChain = Promise.resolve()

  const canRender = (request) => {
    const questions = Array.isArray(request?.questions) ? request.questions : []
    if (questions.length === 0 || questions.length > 4) return false
    return questions.every((question) => {
      if (question?.multiSelect) return false
      const options = Array.isArray(question?.options) ? question.options : []
      return options.length > 0 && options.length <= 5
    })
  }

  const askViaPopup = async (request) => {
    const answers = []
    for (const question of request.questions) {
      const options = question.options
      const lines = [question.question]
      if (question.detail) lines.push('', question.detail)
      const payload = {
        kind: 'question',
        icon: '❓',
        title: squash(question.header ?? t.question, 60),
        body: lines.join('\n'),
        meta: [workspaceLabel(request.agent), t.waiting].filter(Boolean).join(' · '),
        accent: '#f59e0b',
        // Vertical one-per-row options need a little more room than a notice.
        width: 424,
        // The web card always offers a free-text answer next to the options;
        // single-choice questions accept that text on its own.
        allowCustom: true,
        customPlaceholder: t.customPlaceholder,
        sendLabel: t.send,
        actions: options.map((option, index) => ({
          id: `opt-${index}`,
          label: squash(option.label, 40),
          primary: index === 0,
        })),
        timeoutMs: Number(get('questionTimeoutMs')),
      }
      const started = Date.now()
      const result = await show(payload, { blocking: true })
      const elapsedMs = Date.now() - started
      const action = String(result?.action ?? '')
      if (action === 'custom') {
        // Free-text answer: the host treats `custom` as overriding the options
        // of a single-choice question (its `selected` stays empty).
        const text = typeof result?.text === 'string' ? result.text.trim() : ''
        const custom = squash(text, 400)
        if (!custom) {
          note({ kind: 'question-card', outcome: 'custom-empty', elapsedMs })
          return null
        }
        note({ kind: 'question-card', outcome: 'answered-custom', label: squash(custom, 40), elapsedMs })
        answers.push({ id: question.id, selected: [], custom })
        continue
      }
      if (!action.startsWith('opt-')) {
        note({ kind: 'question-card', outcome: action || 'dismissed', elapsedMs, stderr: result?.stderr })
        return null
      }
      const option = options[Number(action.slice(4))]
      if (!option) {
        note({ kind: 'question-card', outcome: `missing-option:${action}` })
        return null
      }
      note({ kind: 'question-card', outcome: 'answered', label: squash(option.label, 40), elapsedMs })
      answers.push({ id: question.id, selected: [option.label] })
    }
    return { answers }
  }

  ctx.on(
    'user-questions/request',
    async (request, next) => {
      if (!get('answerQuestions')) return next()
      if (!canRender(request)) return next()
      const signal = request?.signal
      if (signal !== undefined && signal.aborted) return next()
      const task = questionChain.then(async () => {
        if (signal !== undefined && signal.aborted) return null
        try {
          return await askViaPopup(request)
        } catch (error) {
          log(ctx, 'warn', `question popup failed: ${String(error)}`)
          return null
        }
      })
      questionChain = task.then(
        () => undefined,
        () => undefined,
      )
      const answer = await new Promise((resolve) => {
        let done = false
        const settle = (value) => {
          if (done) return
          done = true
          resolve(value)
        }
        if (signal === undefined) {
          void task.then(settle)
          return
        }
        const onAbort = () => settle(null)
        signal.addEventListener('abort', onAbort, { once: true })
        void task.then((value) => {
          signal.removeEventListener('abort', onAbort)
          settle(value)
        })
      })
      if (answer && Array.isArray(answer.answers) && answer.answers.length === request.questions.length) {
        return answer
      }
      return next()
    },
    { prepend: true },
  )

  log(ctx, 'info', `ready (locale=${locale}, minTurnMs=${get('minTurnMs')}, ps=${POWERSHELL})`)
  note({
    kind: 'activate',
    locale,
    minTurnMs: Number(get('minTurnMs')),
    notifyWhen: get('notifyWhen'),
    sound: get('sound'),
    stateFile: STATE_FILE,
    theme: resolveTheme(get('theme')),
  })
}
