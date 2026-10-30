/**
 * Wiring test for dsh-desktop-notifier.
 *
 * Drives the real `apply()` with a fake Cordis context and the stub renderer,
 * so the event wiring, the payload the card receives, and the
 * ask_user_question waterfall contract are all exercised end to end.
 *
 *   node test/mock-harness.mjs
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'
import { resolveThemePreference } from '../lib/theme.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUB = path.join(HERE, 'stub-popup.ps1')
/** Package root, i.e. the directory the theme resolver derives the profile from. */
const PACKAGE_DIR = path.resolve(HERE, '..')

const dir = mkdtempSync(path.join(tmpdir(), 'dsh-notifier-test-'))
const capture = path.join(dir, 'payloads.log')
writeFileSync(capture, '', 'utf8')
process.env.DSH_NOTIFIER_CAPTURE = capture

const effects = []

/**
 * Fake Cordis context: just enough surface for the plugin to register listeners.
 *
 * Appearance resolution does not go through the host context — it reads the
 * profile patch document — so this fake needs no config service.
 */
function makeCtx() {
  const map = new Map()
  const ctx = {
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    on(name, fn, options) {
      const list = map.get(name) ?? []
      list.push({ fn, options })
      map.set(name, list)
    },
    effect(fn) {
      effects.push(fn)
      fn()
    },
    get() {
      return undefined
    },
  }
  return { ctx, listeners: map }
}

const mainCtx = makeCtx()
const ctx = mainCtx.ctx

apply(ctx, {
  popupScript: STUB,
  minTurnMs: 0,
  infoTimeoutMs: 1000,
  questionTimeoutMs: 3000,
  focusOnOpen: false,
  sound: false,
  locale: 'zh',
})

const listeners = mainCtx.listeners

const failures = []
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`ok   ${label}`)
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const emit = async (name, ...args) => {
  const handlers = listeners.get(name) ?? []
  let last
  for (const handler of handlers) last = await handler.fn(...args)
  return last
}

const emitOn = async (map, name, ...args) => {
  const handlers = map.get(name) ?? []
  let last
  for (const handler of handlers) last = await handler.fn(...args)
  return last
}

/** One complete user turn on `map`, so the notifier renders an info card. */
const runTurnOn = async (map, body) => {
  const header = { id: 'session-theme', cwd: 'C:\\work\\demo-project', origin: 'user' }
  const session = { id: 'session-theme', header }
  const agent = { id: 'session-theme', session }
  await emitOn(map, 'session/event', session, { type: 'user/message', time: Date.now() - 8000, data: {} })
  await emitOn(map, 'session/event', session, {
    type: 'assistant/message',
    time: Date.now(),
    data: { message: { role: 'assistant', content: [{ type: 'text', text: body }] } },
  })
  await emitOn(map, 'agent/turn-stopping', { agent, turn: 1 })
  await wait(900)
}

const capturedPayloads = () =>
  readFileSync(capture, 'utf8')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const actions = () => [...listeners.keys()].sort()

// ── registration ────────────────────────────────────────────────────────────
check('registers agent/turn-stopping', actions().includes('agent/turn-stopping'), actions().join(','))
check('registers session/event', actions().includes('session/event'))
check('registers user-questions/request', actions().includes('user-questions/request'))
const requestRegistration = (listeners.get('user-questions/request') ?? [])[0]
check('user-questions listener is prepended', requestRegistration?.options?.prepend === true)
check('registers cleanup effect', effects.length === 1)

// ── turn completion card ────────────────────────────────────────────────────
const header = { id: 'session-1', cwd: 'C:\\work\\demo-project', origin: 'user' }
const session = { id: 'session-1', header }
const agent = { id: 'session-1', session }

await emit('session/event', session, { type: 'user/message', time: Date.now() - 13000, data: {} })
await emit('session/event', session, {
  type: 'assistant/message',
  time: Date.now(),
  data: { message: { role: 'assistant', content: [{ type: 'text', text: '已修复构建脚本并跑通全部测试。' }] } },
})
await wait(80)
await emit('agent/turn-stopping', { agent, turn: 3 })
await wait(1200)

const info = capturedPayloads().find((payload) => payload.kind === 'info')
check('info card was rendered', info !== undefined)
check('info card title', info?.title === '本轮工作完成', info?.title)
check('info card body is the assistant excerpt', info?.body === '已修复构建脚本并跑通全部测试。', info?.body)
check('info card meta names the workspace', String(info?.meta ?? '').includes('demo-project'), info?.meta)
check('info card offers 查看/关闭', JSON.stringify(info?.actions) === JSON.stringify([
  { id: 'open', label: '查看', primary: true },
  { id: 'close', label: '关闭' },
]), JSON.stringify(info?.actions))
check('info card carries the resolved DSH appearance', info?.theme === resolveThemePreference('auto', PACKAGE_DIR), info?.theme)

// subagents must stay silent
const subHeader = { id: 'session-2', cwd: 'C:\\work\\demo-project', origin: 'subagent', parentSession: 'session-1' }
await emit('session/event', { id: 'session-2', header: subHeader }, { type: 'user/message', time: Date.now() - 9000, data: {} })
await emit('session/event', { id: 'session-2', header: subHeader }, {
  type: 'assistant/message',
  time: Date.now(),
  data: { message: { role: 'assistant', content: [{ type: 'text', text: '子任务完成' }] } },
})
await emit('agent/turn-stopping', { agent: { id: 'session-2', session: { id: 'session-2', header: subHeader } }, turn: 1 })
await wait(900)
check('subagent turn is not announced', capturedPayloads().filter((p) => p.kind === 'info').length === 1)

// ── error card ──────────────────────────────────────────────────────────────
await emit('agent/error', { agent, error: new Error('bash 退出码 1') })
await wait(900)
const errorCard = capturedPayloads().find((payload) => payload.title === '执行出错')
check('error card was rendered', errorCard !== undefined)
check('error card carries the message', errorCard?.body === 'bash 退出码 1', errorCard?.body)

// ── question card answers the tool call ────────────────────────────────────
const request = {
  questions: [
    { id: 'q1', question: '选哪个方案继续？', header: '需要你的决定', options: [{ label: '方案A' }, { label: '方案B：重写' }] },
  ],
  agent,
}
let nextCalls = 0
const answer = await emit('user-questions/request', request, () => {
  nextCalls += 1
  return { answers: [{ id: 'q1', selected: ['网页里的答案'] }] }
})
await wait(800)
const questionCard = capturedPayloads().find((payload) => payload.kind === 'question')
check('question card was rendered', questionCard !== undefined)
check('question card shows one button per option', (questionCard?.actions ?? []).length === 2)
check('question card first option is primary', questionCard?.actions?.[0]?.primary === true)
check('question card marks the choice', questionCard?.meta?.includes('等待你的选择'), questionCard?.meta)
check('answer comes from the card, not the Web UI', nextCalls === 0)
check('answer selects the clicked option', JSON.stringify(answer) === JSON.stringify({ answers: [{ id: 'q1', selected: ['方案A'] }] }), JSON.stringify(answer))

// ── dismissal falls through to the Web UI ──────────────────────────────────
process.env.DSH_NOTIFIER_ACTION = 'dismissed'
let fellThrough = false
const fallback = await emit('user-questions/request', request, () => {
  fellThrough = true
  return { answers: [{ id: 'q1', selected: ['网页选项'] }] }
})
await wait(800)
check('dismissed card falls through to next()', fellThrough === true)
check('fallthrough returns the Web UI answer', fallback?.answers?.[0]?.selected?.[0] === '网页选项', JSON.stringify(fallback))

// ── multi-select and free-form questions stay in the Web UI ────────────────
let multiNext = false
await emit(
  'user-questions/request',
  { questions: [{ id: 'q2', question: '选多个', multiSelect: true, options: [{ label: 'x' }, { label: 'y' }] }], agent },
  () => {
    multiNext = true
    return { answers: [] }
  },
)
check('multiSelect question is left to the Web UI', multiNext === true)

// ── appearance: explicit plugin config wins, auto defers to the profile ─────
const cardByBody = (body) => capturedPayloads().find((payload) => payload.body === body)

const overrideCtx = makeCtx()
apply(overrideCtx.ctx, {
  popupScript: STUB,
  minTurnMs: 0,
  infoTimeoutMs: 800,
  focusOnOpen: false,
  sound: false,
  theme: 'dark',
})
await runTurnOn(overrideCtx.listeners, '主题测试：显式深色')
const forcedCard = cardByBody('主题测试：显式深色')
check('explicit theme overrides the DSH preference', forcedCard?.theme === 'dark', forcedCard?.theme)

const autoCtx = makeCtx()
apply(autoCtx.ctx, { popupScript: STUB, minTurnMs: 0, infoTimeoutMs: 800, focusOnOpen: false, sound: false })
await runTurnOn(autoCtx.listeners, '主题测试：自动跟随')
const autoCard = cardByBody('主题测试：自动跟随')
check('auto theme defers to the DSH profile patch', autoCard?.theme === resolveThemePreference('auto', PACKAGE_DIR), autoCard?.theme)

process.exitCode = failures.length === 0 ? 0 : 1
console.log(failures.length === 0 ? '\nall wiring checks passed' : `\n${failures.length} check(s) failed`)
