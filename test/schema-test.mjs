/**
 * Config schema checks: the validated config the Loader hands to apply().
 *
 * Run with: node test/schema-test.mjs
 */
import { Config } from '../index.js'

const base = {
  enabled: true,
  minTurnMs: 5000,
  notifyOnTurnEnd: true,
  notifyOnError: true,
  infoTimeoutMs: 12000,
  answerQuestions: true,
  questionTimeoutMs: 60000,
  maxBodyChars: 260,
  theme: 'auto',
  sound: 'default',
  notifyWhen: 'always',
  focusOnOpen: true,
  locale: 'zh',
}

let failed = 0
/** Volatile fields arrive as `{ get() }` accessors; read either shape. */
const val = (x) => (x !== null && typeof x === 'object' && typeof x.get === 'function' ? x.get() : x)
const check = (name, run) => {
  try {
    run()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}: ${String(error && error.message ? error.message : error)}`)
  }
}
const reject = (name, run) => {
  try {
    run()
    failed += 1
    console.log(`FAIL ${name}: expected the schema to reject the value`)
  } catch {
    console.log(`ok   ${name}`)
  }
}

check('current settings row validates', () => Config(base))
check('empty config falls back to defaults', () => {
  const out = Config({})
  const got = { theme: val(out.theme), sound: val(out.sound), notifyWhen: val(out.notifyWhen) }
  if (got.theme !== 'auto' || got.sound !== 'default' || got.notifyWhen !== 'always') {
    throw new Error(`unexpected defaults ${JSON.stringify(got)}`)
  }
})
check('every documented sound validates', () => {
  for (const name of ['default', 'none', 'notify', 'ding', 'chimes', 'tada', 'question', 'asterisk', 'exclamation', 'critical', 'email', 'calendar', 'messaging', 'nudge', 'reminder']) {
    Config({ ...base, sound: name })
  }
})
check('legacy boolean sound still validates (true/false)', () => {
  Config({ ...base, sound: true })
  Config({ ...base, sound: false })
})
check('notifyWhen accepts unfocused', () => Config({ ...base, notifyWhen: 'unfocused' }))
reject('unknown sound is rejected', () => Config({ ...base, sound: 'trumpet' }))
reject('unknown notifyWhen is rejected', () => Config({ ...base, notifyWhen: 'sometimes' }))
reject('unknown theme is rejected', () => Config({ ...base, theme: 'sepia' }))
reject('locale only zh|en', () => Config({ ...base, locale: 'fr' }))

if (failed > 0) {
  console.log(`\n${failed} schema check(s) failed`)
  process.exit(1)
}
console.log('\nall schema checks passed')
