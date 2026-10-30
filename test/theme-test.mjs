/**
 * Unit tests for the appearance resolver (lib/theme.js).
 *
 *   node test/theme-test.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  profilePatchPath,
  readPreferenceFromPatch,
  readPreferenceFromPatchText,
  resolveThemePreference,
} from '../lib/theme.js'

let failures = 0
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`ok   ${label}`)
  } else {
    failures += 1
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── row scanning ────────────────────────────────────────────────────────────
const nestedRow = [
  '- insert:',
  '    - id: ui-theme',
  '      name: "@deepseek-ai/dsh-client-ui-theme"',
  '      config:',
  '        preference: dark',
].join('\n')
check('reads a dark preference from a nested row', readPreferenceFromPatchText(nestedRow) === 'dark', readPreferenceFromPatchText(nestedRow))

const singleQuoted = ['- id: ui-theme', "  name: '@deepseek-ai/dsh-client-ui-theme'", '  config:', '    preference: light'].join('\n')
check('reads a light preference next to a single-quoted name', readPreferenceFromPatchText(singleQuoted) === 'light')

const inline = ['- id: ui-theme', '  config: { preference: system }'].join('\n')
check('reads an inline flow preference', readPreferenceFromPatchText(inline) === 'system', readPreferenceFromPatchText(inline))

const unrelated = ['- id: locale', '  name: "@deepseek-ai/dsh-client-locale"', '  config:', '    preference: dark'].join('\n')
check('ignores a preference on another row', readPreferenceFromPatchText(unrelated) === null)

const noPreference = ['- id: ui-theme', '  name: "@deepseek-ai/dsh-client-ui-theme"', '  config:', '    fontSize: 15'].join('\n')
check('returns null when the theme row only changes fontSize', readPreferenceFromPatchText(noPreference) === null)

const afterTheme = ['- id: ui-theme', '  config:', '    preference: dark', '- id: locale', '  config:', '    preference: light'].join('\n')
check('stops at the end of the theme row', readPreferenceFromPatchText(afterTheme) === 'dark')

check('returns null for empty input', readPreferenceFromPatchText('') === null)
check('returns null for non-string input', readPreferenceFromPatchText(undefined) === null)

// ── file plumbing ───────────────────────────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), 'dsh-theme-test-'))
const packageDir = path.join(root, 'profile', 'node_modules', 'dsh-desktop-notifier')
mkdirSync(packageDir, { recursive: true })
const patchFile = path.join(root, 'profile', 'cordis.patch.yml')

check('profile patch path sits two directories above the package', profilePatchPath(packageDir) === patchFile, profilePatchPath(packageDir))
check('missing package dir resolves to null', profilePatchPath('') === null)

check('unreadable patch returns null', readPreferenceFromPatch(path.join(root, 'profile', 'nope.yml')) === null)

writeFileSync(patchFile, nestedRow, 'utf8')
check('reads the preference from a real file', readPreferenceFromPatch(patchFile) === 'dark')

// ── resolution order ───────────────────────────────────────────────────────
check('auto follows the persisted dark preference', resolveThemePreference('auto', packageDir) === 'dark')
check('explicit light beats the persisted preference', resolveThemePreference('light', packageDir) === 'light')
check('explicit system is passed through', resolveThemePreference('system', packageDir) === 'system')
check('auto without a patch follows the system theme', resolveThemePreference('auto', path.join(root, 'nothing')) === 'system')

writeFileSync(patchFile, noPreference, 'utf8')
check('auto falls back to system when the row has no preference', resolveThemePreference('auto', packageDir) === 'system')

rmSync(root, { recursive: true, force: true })

console.log(failures === 0 ? '\nall theme checks passed' : `\n${failures} theme check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
