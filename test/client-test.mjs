/**
 * Browser-half smoke test: loads lib/client.js the way the Web module loader
 * does, mounts the settings section into a stub slot ledger, renders it with a
 * tiny hook shim, and drives the two new controls.
 *
 * Run with: node test/client-test.mjs
 */

let failed = 0
const check = (name, run) => {
  try {
    const result = run()
    if (result && typeof result.then === 'function') {
      return result.then(
        () => console.log(`ok   ${name}`),
        (error) => {
          failed += 1
          console.log(`FAIL ${name}: ${String(error && error.message ? error.message : error)}`)
        },
      )
    }
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}: ${String(error && error.message ? error.message : error)}`)
  }
  return undefined
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

/* ---------------------------------------------------------------- DOM stub */

const styles = []
globalThis.document = {
  head: { appendChild: (el) => styles.push(el) },
  createElement: (tag) => ({ tag, dataset: {}, textContent: '', remove() {} }),
  querySelector: () => null,
}

/* --------------------------------------------------------------- React stub */

const hooks = []
const react = {
  createElement(type, props, ...children) {
    return {
      type,
      props: props || {},
      children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
    }
  },
  Fragment: 'Fragment',
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    const setter = (next) => {
      hooks.push({ value: next })
    }
    return [value, setter]
  },
  useEffect(effect) {
    const cleanup = effect()
    if (typeof cleanup === 'function') hooks.push({ cleanup })
  },
  useMemo(factory) {
    return factory()
  },
  useCallback(fn) {
    return fn
  },
  useRef(initial) {
    return { current: initial }
  },
  useId() {
    return 'dn-test-id'
  },
}

/* ---------------------------------------------------- config-form controller */

const writes = []
const unsets = []
const snapshot = {
  status: 'ready',
  value: {
    enabled: true,
    notifyOnTurnEnd: true,
    notifyOnError: true,
    notifyWhen: 'always',
    answerQuestions: true,
    minTurnMs: 5000,
    infoTimeoutMs: 12000,
    questionTimeoutMs: 60000,
    maxBodyChars: 260,
    theme: 'auto',
    sound: 'default',
    focusOnOpen: true,
    locale: 'zh',
    diagnostics: true,
  },
  base: {},
  user: {},
  revision: 3,
  writable: true,
}
const host = {
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
  set: async (field, value) => {
    writes.push([field, value])
    return true
  },
  unset: async (field) => {
    unsets.push(field)
    return true
  },
  mutate: async () => true,
}

/* ------------------------------------------------------ module-loader stub */

let registration
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      registration = def
    },
  },
}

await import(new URL('../lib/client.js', import.meta.url).href + '?smoke=1')

await check('loader registration id', () => {
  assert(registration, 'lib/client.js did not call window.__ModuleLoader__.load')
  assert(registration.id === 'dsh-desktop-notifier', `unexpected id ${registration.id}`)
})
await check('factory builds a CommonJS-shaped module', () => {
  const exports = registration.factory((specifier) => {
    assert(specifier === 'react', `unexpected require(${specifier})`)
    return react
  })
  assert(typeof exports.apply === 'function', 'apply is missing')
  assert(Array.isArray(exports.inject), 'inject is missing')
  assert(exports.inject.join(',') === 'slots,locale,configForms', `unexpected inject ${exports.inject.join(',')}`)
})

const browserHalf = registration.factory(() => react)

let section
const registrations = []
const localeRegistrations = []
const fakeCtx = {
  effect(callback) {
    const cleanup = callback()
    if (typeof cleanup === 'function') hooks.push({ cleanup })
  },
  locale: {
    bind: () => (key) => fakeCtx.locale.dictionaries[key] ?? key,
    register(namespace, dictionaries) {
      fakeCtx.locale.dictionaries = dictionaries.zh
      localeRegistrations.push([namespace, dictionaries])
      return () => {}
    },
  },
  slots: {
    inject(name, callback) {
      assert(name === 'settings.section', `unexpected slot ${name}`)
      callback()
    },
    register(def, Component) {
      section = { def, Component }
      registrations.push(def)
      return () => {}
    },
  },
  configForms: {
    get(entryId) {
      assert(entryId === 'desktop-notifier', `unexpected entry id ${entryId}`)
      return host
    },
  },
}
fakeCtx.locale.dictionaries = {}

await check('apply injects the stylesheet once', () => {
  browserHalf.apply(fakeCtx)
  assert(styles.length === 1, `expected 1 style tag, got ${styles.length}`)
  assert(styles[0].textContent.includes('--dsw-alias-label-primary'), 'stylesheet does not use DSH tokens')
})
await check('apply registers the settings dictionaries', () => {
  assert(localeRegistrations.length === 1, 'locale.register was not called once')
  assert(localeRegistrations[0][0] === 'desktop-notifier', `unexpected namespace ${localeRegistrations[0][0]}`)
  assert(localeRegistrations[0][1].zh && localeRegistrations[0][1].en, 'both dictionaries are required')
})
await check('apply registers the settings section', () => {
  assert(section, 'no settings.section registration')
  assert(section.def.name === 'settings.section', `unexpected slot name ${section.def.name}`)
  assert(section.def.id === 'desktop-notifier', `unexpected section id ${section.def.id}`)
  assert(section.def.order === 42, `unexpected order ${section.def.order}`)
  assert(section.def.label() === '桌面通知', `unexpected label ${section.def.label()}`)
  assert(section.def.locale === 'desktop-notifier', `unexpected locale ${section.def.locale}`)
})

/* ------------------------------------------------------------------ render */

const flat = (node, out = []) => {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) flat(child, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (typeof node === 'object') {
    out.push(node)
    for (const child of node.children || []) flat(child, out)
  }
  return out
}
/**
 * Expand function components the way a React reconciler would, so the tree this
 * test inspects contains the host nodes (Row/Switch/Segmented are components).
 */
const expand = (node) => {
  if (Array.isArray(node)) return node.flatMap((child) => expand(child))
  if (node === null || node === undefined || node === false) return node
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    const children = node.children || []
    const props = { ...node.props, children: children.length === 1 ? children[0] : children }
    return expand(node.type(props))
  }
  return { ...node, children: (node.children || []).flatMap((child) => expand(child)) }
}
const textOf = (node) => flat(node).filter((x) => typeof x === 'string').join(' ')
const findNodes = (node, predicate, out = []) => {
  for (const item of flat(node)) {
    if (typeof item === 'object' && predicate(item)) out.push(item)
  }
  return out
}

const t = (key) => fakeCtx.locale.dictionaries[key] ?? key
let tree
await check('component renders', () => {
  tree = expand(section.Component({ t }))
  assert(tree, 'component returned nothing')
  const text = textOf(tree)
  assert(text.includes('桌面通知'), 'missing page title')
  assert(text.includes('通知时机'), 'missing notifyWhen row')
  assert(text.includes('仅在未聚焦时'), 'missing unfocused option')
  assert(text.includes('提示音'), 'missing sound row')
  assert(text.includes('默认（按卡片类型）'), 'missing default sound option')
  assert(text.includes('跟随 DSH 外观'), 'missing theme row')
})
await check('sound select writes the chosen sound', async () => {
  const selects = findNodes(tree, (node) => node.props.className === 'dn-select')
  assert(selects.length === 3, `expected 3 selects, got ${selects.length}`)
  const sound = selects[0]
  assert(sound.props.value === 'default', `unexpected initial sound ${sound.props.value}`)
  await sound.props.onChange({ target: { value: 'tada' } })
  const entry = writes.find(([field]) => field === 'sound')
  assert(entry && entry[1] === 'tada', `sound was not written: ${JSON.stringify(writes)}`)
})
await check('notifyWhen segmented control writes unfocused', async () => {
  const buttons = findNodes(
    tree,
    (node) => node.type === 'button' && node.props.className === 'dn-seg-item' && textOf(node).trim() === '仅在未聚焦时',
  )
  assert(buttons.length === 1, `expected 1 unfocused button, got ${buttons.length}`)
  await buttons[0].props.onClick()
  const entry = writes.find(([field]) => field === 'notifyWhen')
  assert(entry && entry[1] === 'unfocused', `notifyWhen was not written: ${JSON.stringify(writes)}`)
})
await check('overridden fields offer a reset action', async () => {
  snapshot.user = { sound: 'tada' }
  const reTree = expand(section.Component({ t }))
  const reset = findNodes(reTree, (node) => node.type === 'button' && node.props.className === 'dn-reset')
  assert(reset.length === 1, `expected 1 reset button, got ${reset.length}`)
  await reset[0].props.onClick()
  assert(unsets.includes('sound'), `sound was not reset: ${JSON.stringify(unsets)}`)
  snapshot.user = {}
})
await check('unavailable config shows the fallback copy', () => {
  const held = snapshot.status
  snapshot.status = 'unavailable'
  const fallback = expand(section.Component({ t }))
  snapshot.status = held
  assert(textOf(fallback).includes('该插件当前未加载'), 'missing unavailable copy')
})

/* ------------------------------------------------------------------ report */

if (failed > 0) {
  console.log(`\n${failed} client check(s) failed`)
  process.exit(1)
}
console.log('\nall client checks passed')
