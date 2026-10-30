/**
 * Appearance resolution for the desktop popup.
 *
 * The popup must match the DSH window: when DSH renders light, the card is
 * light; when DSH renders dark, the card is dark. DSH's own setting lives in the
 * ui-theme plugin, whose user override is persisted as a row in the active
 * profile patch (`<profile>/cordis.patch.yml`). The row looks like:
 *
 *     - id: ui-theme
 *       name: "@deepseek-ai/dsh-client-ui-theme"
 *       config:
 *         preference: dark        # light | dark | system
 *
 * Reading that single value needs no YAML dependency, so this module scans the
 * document row by row. Resolution order in the caller is:
 *   1. an explicit plugin config (`light` / `dark` / `system`), else
 *   2. the persisted DSH preference, else
 *   3. `system` — the theme plugin's shipped default, which the renderer turns
 *      into the Windows app theme (HKCU …\Themes\Personalize\AppsUseLightTheme).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

export const THEME_ENTRY_ID = 'ui-theme'
export const THEME_PACKAGE = '@deepseek-ai/dsh-client-ui-theme'

const PREFERENCE_RE = /preference:\s*['"]?(light|dark|system)['"]?/

/**
 * Appearance preference found in a profile patch document.
 *
 * @param {string} text raw YAML of a profile patch
 * @returns {'light' | 'dark' | 'system' | null} null when the document has no
 *   ui-theme override
 */
export function readPreferenceFromPatchText(text) {
  if (typeof text !== 'string' || text.length === 0) return null
  let inThemeRow = false
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    // Any top-level row start closes the previous row.
    if (/^-\s/.test(trimmed)) inThemeRow = false
    if (trimmed === `- id: ${THEME_ENTRY_ID}`) {
      inThemeRow = true
      continue
    }
    if (trimmed === `name: "${THEME_PACKAGE}"` || trimmed === `name: '${THEME_PACKAGE}'` || trimmed === `name: ${THEME_PACKAGE}`) {
      inThemeRow = true
      continue
    }
    if (!inThemeRow) continue
    if (trimmed.startsWith('#')) continue
    const match = PREFERENCE_RE.exec(trimmed)
    if (match) return match[1]
  }
  return null
}

/**
 * Appearance preference persisted at `file`, or null when unreadable/absent.
 *
 * @param {string} file path of a profile patch
 */
export function readPreferenceFromPatch(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  return readPreferenceFromPatchText(text)
}

/**
 * Path of the profile patch that owns this installation.
 *
 * An installed bundle lives at `<profile>/node_modules/<name>`, so the patch sits
 * two directories above this file's package root. A source checkout (which has
 * no profile patch next to it) resolves to `null`.
 *
 * @param {string} packageDir absolute path of the plugin package
 * @returns {string | null}
 */
export function profilePatchPath(packageDir) {
  try {
    if (typeof packageDir !== 'string' || packageDir.length === 0) return null
    return path.resolve(packageDir, '..', '..', 'cordis.patch.yml')
  } catch {
    return null
  }
}

/**
 * Resolve the card theme from plugin config and the persisted DSH preference.
 *
 * @param {'auto' | 'light' | 'dark' | 'system'} configured
 * @param {string} packageDir absolute path of the plugin package
 * @returns {'light' | 'dark' | 'system'}
 */
export function resolveThemePreference(configured, packageDir) {
  if (configured === 'light' || configured === 'dark' || configured === 'system') return configured
  const file = profilePatchPath(packageDir)
  const stored = file === null ? null : readPreferenceFromPatch(file)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}
