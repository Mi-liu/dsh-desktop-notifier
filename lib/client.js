/**
 * dsh-desktop-notifier — browser half.
 *
 * Renders the plugin's own page inside Settings (a `settings.section` slot) and
 * writes every change straight into the plugin's durable config through the
 * shared config-form controller (`ctx.configForms.get("desktop-notifier")`).
 *
 * Only baseline modules are requested: `react` comes from the platform seed
 * table, so no `dsh.client.external` entry is needed.
 */
window.__ModuleLoader__.load({
  id: 'dsh-desktop-notifier',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')

    /** Locale dictionary namespace owned by this plugin (also the slot locale). */
    const NS = 'desktop-notifier'
    /** Host plugin row id = settings namespace of this plugin's config. */
    const ENTRY_ID = 'desktop-notifier'

    const zh = {
      nav: '桌面通知',
      title: '桌面通知',
      intro: '每当一轮工作结束或有步骤出错时，在 Windows 桌面右下角弹出一张卡片；当助手需要你选择时，弹出可直接点选答案的卡片。以下设置即时保存并立即生效。',
      unavailable: '该插件当前未加载，暂时无法配置。',
      readOnly: '本部署的设置为只读。',
      enableGroup: '通知范围',
      enabled: '启用桌面通知',
      enabledHint: '关闭后不再弹出任何卡片。',
      notifyOnTurnEnd: '每轮结束提醒',
      notifyOnTurnEndHint: '助手回答完一轮后弹出一张完成卡片。',
      notifyOnError: '步骤出错提醒',
      notifyOnErrorHint: '本轮执行失败时弹出一张错误卡片。',
      answerQuestions: '允许在桌面回答提问',
      answerQuestionsHint: '助手需要你决定时，弹出一张可点选的卡片；关掉后只在 Web 界面里询问。',
      conditionGroup: '通知条件',
      notifyWhen: '通知时机',
      notifyWhenAlways: '总是通知',
      notifyWhenUnfocused: '仅在未聚焦时',
      notifyWhenHint: '“仅在未聚焦时”表示 DSH 窗口处于前台时静默跳过，切到其他程序时照常提醒。',
      soundGroup: '提醒方式',
      sound: '提示音',
      soundHint: '弹窗出现时播放的声音；静音表示完全无声。',
      soundDefault: '默认（按卡片类型）',
      soundNone: '静音',
      soundNotify: '系统通知',
      soundDing: '叮',
      soundChimes: '风铃',
      soundTada: '完成音',
      soundEmail: '邮件',
      soundCalendar: '日历提醒',
      soundMessaging: '消息',
      soundNudge: '轻提示',
      soundReminder: '系统提示',
      soundQuestion: '提问音',
      soundAsterisk: '提示音',
      soundExclamation: '警告音',
      soundCritical: '错误音',
      appearanceGroup: '外观与交互',
      theme: '卡片外观',
      themeHint: '跟随 DSH 外观时会使用当前浅色/深色主题的同一套配色。',
      themeAuto: '跟随 DSH 外观',
      themeLight: '浅色',
      themeDark: '深色',
      themeSystem: '跟随系统',
      focusOnOpen: '点击“查看”时聚焦窗口',
      focusOnOpenHint: '点击卡片上的“查看”按钮后，把 DSH 主窗口切到前台。',
      timingGroup: '时间与内容',
      minTurnMs: '最短耗时提醒（秒）',
      minTurnMsHint: '只提醒耗时超过该值的轮次，避免为秒回消息打扰你；填 0 表示每轮都提醒。',
      infoTimeoutMs: '通知卡停留（秒）',
      infoTimeoutMsHint: '完成/错误卡片自动消失的时间，0 表示一直留着。',
      questionTimeoutMs: '选择卡等待（秒）',
      questionTimeoutMsHint: '等待你点选答案的时间；超时后交由 Web 界面继续询问。',
      maxBodyChars: '正文最多字符数',
      maxBodyCharsHint: '卡片正文超出时自动截断。',
      language: '语言',
      languageHint: '卡片文案使用的语言（Web 设置页本身跟随界面语言）。',
      langZh: '中文',
      langEn: 'English',
      saving: '保存中…',
      saved: '已保存',
      failed: '保存失败，数值已恢复',
      reset: '恢复默认',
      numberPlaceholder: '留空使用默认值',
      seconds: '秒',
      chars: '字'
    }

    const en = {
      nav: 'Desktop notifications',
      title: 'Desktop notifications',
      intro: 'Shows a card in the bottom-right corner of the Windows desktop when a turn finishes or a step fails, and a clickable card when the assistant needs your decision. Changes are saved and applied immediately.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      readOnly: 'This deployment stores settings read-only.',
      enableGroup: 'Scope',
      enabled: 'Enable desktop notifications',
      enabledHint: 'Turn off to stop every card.',
      notifyOnTurnEnd: 'Notify when a turn finishes',
      notifyOnTurnEndHint: 'Show a completion card after the assistant answers.',
      notifyOnError: 'Notify when a step fails',
      notifyOnErrorHint: 'Show an error card when the current turn fails.',
      answerQuestions: 'Answer questions on the desktop',
      answerQuestionsHint: 'Ask with a clickable desktop card; when off, questions stay in the Web UI only.',
      conditionGroup: 'Conditions',
      notifyWhen: 'When to notify',
      notifyWhenAlways: 'Always',
      notifyWhenUnfocused: 'Only when unfocused',
      notifyWhenHint: '"Only when unfocused" skips the card (and its sound) while the DSH window is in the foreground.',
      soundGroup: 'Alert',
      sound: 'Sound',
      soundHint: 'Played when a card appears; "None" is completely silent.',
      soundDefault: 'Default (by card type)',
      soundNone: 'None',
      soundNotify: 'System notification',
      soundDing: 'Ding',
      soundChimes: 'Chimes',
      soundTada: 'Tada',
      soundEmail: 'Email',
      soundCalendar: 'Calendar',
      soundMessaging: 'Messaging',
      soundNudge: 'Nudge',
      soundReminder: 'Reminder',
      soundQuestion: 'Question',
      soundAsterisk: 'Asterisk',
      soundExclamation: 'Exclamation',
      soundCritical: 'Critical',
      appearanceGroup: 'Appearance',
      theme: 'Card appearance',
      themeHint: '"Follow DSH appearance" reuses the exact light or dark palette of the current theme.',
      themeAuto: 'Follow DSH appearance',
      themeLight: 'Light',
      themeDark: 'Dark',
      themeSystem: 'Follow system',
      focusOnOpen: 'Focus the window on "Open"',
      focusOnOpenHint: 'Bring the DSH main window to the front when "Open" is clicked.',
      timingGroup: 'Timing & content',
      minTurnMs: 'Minimum turn duration (s)',
      minTurnMsHint: 'Only notify for turns longer than this, to skip instant replies; 0 always notifies.',
      infoTimeoutMs: 'Notification card lifetime (s)',
      infoTimeoutMsHint: 'How long completion/error cards stay visible; 0 keeps them.',
      questionTimeoutMs: 'Question card wait (s)',
      questionTimeoutMsHint: 'How long a choice card waits before falling back to the Web UI.',
      maxBodyChars: 'Max body characters',
      maxBodyCharsHint: 'The card body is truncated beyond this length.',
      language: 'Language',
      languageHint: 'Language of the card copy (this settings page follows the UI language).',
      langZh: '中文',
      langEn: 'English',
      saving: 'Saving…',
      saved: 'Saved',
      failed: 'Save failed; the value was restored',
      reset: 'Reset to default',
      numberPlaceholder: 'Blank uses the default',
      seconds: 's',
      chars: 'chars'
    }

    const SOUND_DEFAULT = 'default'
    // [value, locale key] — must stay in sync with scripts/popup.ps1.
    const SOUND_OPTIONS = [
      [SOUND_DEFAULT, 'soundDefault'],
      ['none', 'soundNone'],
      ['notify', 'soundNotify'],
      ['ding', 'soundDing'],
      ['chimes', 'soundChimes'],
      ['tada', 'soundTada'],
      ['email', 'soundEmail'],
      ['calendar', 'soundCalendar'],
      ['messaging', 'soundMessaging'],
      ['nudge', 'soundNudge'],
      ['reminder', 'soundReminder'],
      ['question', 'soundQuestion'],
      ['asterisk', 'soundAsterisk'],
      ['exclamation', 'soundExclamation'],
      ['critical', 'soundCritical']
    ]

    const STYLE_ID = 'dsh-desktop-notifier/settings.css'
    const STYLES = `
.dn-settings{display:flex;flex-direction:column;gap:6px;padding:24px 4px 40px;color:var(--dsw-alias-label-primary,inherit)}
.dn-head{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.dn-title{font-size:16px;font-weight:600;line-height:24px;margin:0}
.dn-intro{font-size:13px;line-height:20px;margin:0;color:var(--dsw-alias-label-secondary,inherit)}
.dn-group{margin-top:18px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary,inherit);text-transform:none}
.dn-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:16px;row-gap:4px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,transparent)}
.dn-label{font-size:14px;line-height:22px}
.dn-hint{grid-column:1/-1;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit);max-width:64ch}
.dn-flash{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit)}
.dn-flash-err{color:var(--dsw-alias-state-error-primary,#ec1313)}
.dn-switch{position:relative;width:40px;height:22px;flex:none;border-radius:11px;border:.5px solid var(--dsw-alias-border-l3,currentColor);background:transparent;cursor:pointer;padding:0;transition:background .16s ease,border-color .16s ease}
.dn-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-tertiary,currentColor);transition:transform .16s ease,background .16s ease}
.dn-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary,#4176e6);border-color:transparent}
.dn-switch[aria-checked="true"]::after{transform:translateX(18px);background:#fff}
.dn-switch:disabled{cursor:not-allowed;opacity:.5}
.dn-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}
.dn-seg{display:inline-flex;border:.5px solid var(--dsw-alias-border-l3,currentColor);border-radius:8px;overflow:hidden}
.dn-seg-item{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:13px;padding:6px 12px;cursor:pointer}
.dn-seg-item:hover:not(.dn-seg-active){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dn-seg-active{background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.18));color:var(--dsw-alias-label-primary,inherit)}
.dn-seg-item:disabled{cursor:not-allowed;opacity:.5}
.dn-select,.dn-input{appearance:none;box-sizing:border-box;height:30px;min-width:132px;padding:0 8px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2,currentColor);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px}
.dn-input{min-width:84px;max-width:110px;text-align:right}
.dn-input::placeholder{color:var(--dsw-alias-label-tertiary,inherit)}
.dn-select:disabled,.dn-input:disabled{cursor:not-allowed;opacity:.5}
.dn-unit{font-size:12px;color:var(--dsw-alias-label-tertiary,inherit);margin-left:6px}
.dn-inline{display:flex;align-items:center;gap:8px}
.dn-reset{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,inherit);font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:6px;text-decoration:underline;text-underline-offset:2px}
.dn-reset:hover{color:var(--dsw-alias-label-primary,inherit)}
`

    function installStyles(ctx) {
      if (typeof document === 'undefined') return
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-desktop-notifier'
        tag.dataset.pluginCss = STYLE_ID
        tag.textContent = STYLES
        document.head.appendChild(tag)
        return () => {
          tag.remove()
        }
      }, 'dsh-desktop-notifier: settings stylesheet')
    }

    /**
     * Read-only view over the plugin config plus an optimistic write layer, so a
     * control reflects a change immediately while the host round-trip settles.
     */
    function useConfigForm(host) {
      const [snapshot, setSnapshot] = react.useState(() => host.getSnapshot())
      const [pending, setPending] = react.useState({})
      const [status, setStatus] = react.useState('idle')
      react.useEffect(
        () =>
          host.subscribe(() => {
            setSnapshot(host.getSnapshot())
          }),
        [],
      )
      react.useEffect(() => {
        if (Object.keys(pending).length > 0 || status === 'idle') return
        const timer = setTimeout(() => setStatus('idle'), 1600)
        return () => clearTimeout(timer)
      }, [status, pending])
      const value = { ...(snapshot.value || {}), ...pending }
      const setStatusAfter = async (operation) => {
        setStatus('saving')
        try {
          const accepted = await operation()
          setStatus(accepted === false ? 'failed' : 'saved')
          return accepted
        } catch (error) {
          setStatus('failed')
          return false
        }
      }
      const write = async (field, next) => {
        setPending((prev) => ({ ...prev, [field]: next }))
        try {
          return await setStatusAfter(() => host.set(field, next))
        } finally {
          setPending((prev) => {
            const copy = { ...prev }
            delete copy[field]
            return copy
          })
        }
      }
      const unset = async (field) => {
        setPending((prev) => ({ ...prev, [field]: undefined }))
        try {
          return await setStatusAfter(() => host.unset(field))
        } finally {
          setPending((prev) => {
            const copy = { ...prev }
            delete copy[field]
            return copy
          })
        }
      }
      const user = snapshot.user || {}
      const isOverridden = (field) => Object.prototype.hasOwnProperty.call(user, field)
      return { value, snapshot, write, unset, isOverridden, status }
    }

    function createSettingsSection(host, t) {
      const h = react.createElement

      function Row({ label, hint, children, onReset, disabled }) {
        return h(
          'div',
          { className: 'dn-row' },
          h('div', { className: 'dn-label' }, label),
          h(
            'div',
            { className: 'dn-inline' },
            children,
            onReset && !disabled
              ? h(
                  'button',
                  { type: 'button', className: 'dn-reset', title: t('reset'), onClick: onReset },
                  t('reset'),
                )
              : null,
          ),
          hint ? h('div', { className: 'dn-hint' }, hint) : null,
        )
      }

      function Switch({ checked, disabled, onChange, label }) {
        return h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          className: 'dn-switch',
          disabled,
          onClick: () => onChange(!checked),
        })
      }

      function Segmented({ options, value, disabled, onChange }) {
        return h(
          'div',
          { className: 'dn-seg' },
          options.map((option) =>
            h(
              'button',
              {
                key: option.value,
                type: 'button',
                className: 'dn-seg-item' + (option.value === value ? ' dn-seg-active' : ''),
                'aria-pressed': option.value === value ? 'true' : 'false',
                disabled,
                onClick: () => onChange(option.value),
              },
              option.label,
            ),
          ),
        )
      }

      function numberInput({ value, disabled, onChange, unit, placeholder }) {
        return [
          h('input', {
            key: 'input',
            type: 'number',
            className: 'dn-input',
            min: 0,
            step: 1,
            disabled,
            placeholder,
            value: value === undefined || value === null ? '' : String(value),
            onChange: (event) => {
              const raw = event.target.value
              if (raw === '') return onChange(undefined)
              const parsed = Number(raw)
              if (!Number.isFinite(parsed) || parsed < 0) return
              onChange(parsed)
            },
          }),
          unit ? h('span', { key: 'unit', className: 'dn-unit' }, unit) : null,
        ]
      }

      return function DesktopNotifierSettings(props) {
        const read = props && typeof props.t === 'function' ? props.t : t
        const state = useConfigForm(host)
        const snapshot = state.snapshot
        const unavailable = snapshot && snapshot.status && snapshot.status !== 'ready'
        const ready = Boolean(snapshot && snapshot.value) && !unavailable
        const disabled = !ready || snapshot.writable === false
        const form = state.value
        const write = state.write
        const unset = state.unset
        const isOverridden = state.isOverridden
        const label = (key) => read(key)

        if (!ready) {
          return h(
            'div',
            { className: 'dn-settings' },
            h('h2', { className: 'dn-title' }, label('title')),
            h('p', { className: 'dn-intro' }, label('unavailable')),
          )
        }

        const secondsToMs = (value) => (value === undefined || value === null ? undefined : Math.round(value * 1000))
        const msToSeconds = (value) => (value === undefined || value === null ? undefined : Math.round(value / 1000))

        return h(
          'div',
          { className: 'dn-settings' },
          h(
            'div',
            { className: 'dn-head' },
            h('h2', { className: 'dn-title' }, label('title')),
            h('p', { className: 'dn-intro' }, label('intro')),
          ),
          snapshot.writable === false ? h('p', { className: 'dn-flash dn-flash-err' }, label('readOnly')) : null,

          h('div', { className: 'dn-group' }, label('enableGroup')),
          h(
            Row,
            { label: label('enabled'), hint: label('enabledHint'), disabled },
            h(Switch, {
              checked: Boolean(form.enabled),
              disabled,
              label: label('enabled'),
              onChange: (next) => write('enabled', next),
            }),
          ),
          h(
            Row,
            { label: label('notifyOnTurnEnd'), hint: label('notifyOnTurnEndHint'), disabled },
            h(Switch, {
              checked: Boolean(form.notifyOnTurnEnd),
              disabled,
              label: label('notifyOnTurnEnd'),
              onChange: (next) => write('notifyOnTurnEnd', next),
            }),
          ),
          h(
            Row,
            { label: label('notifyOnError'), hint: label('notifyOnErrorHint'), disabled },
            h(Switch, {
              checked: Boolean(form.notifyOnError),
              disabled,
              label: label('notifyOnError'),
              onChange: (next) => write('notifyOnError', next),
            }),
          ),
          h(
            Row,
            { label: label('answerQuestions'), hint: label('answerQuestionsHint'), disabled },
            h(Switch, {
              checked: Boolean(form.answerQuestions),
              disabled,
              label: label('answerQuestions'),
              onChange: (next) => write('answerQuestions', next),
            }),
          ),

          h('div', { className: 'dn-group' }, label('conditionGroup')),
          h(
            Row,
            { label: label('notifyWhen'), hint: label('notifyWhenHint'), disabled },
            h(Segmented, {
              options: [
                { value: 'always', label: label('notifyWhenAlways') },
                { value: 'unfocused', label: label('notifyWhenUnfocused') },
              ],
              value: form.notifyWhen || 'always',
              disabled,
              onChange: (next) => write('notifyWhen', next),
            }),
          ),

          h('div', { className: 'dn-group' }, label('soundGroup')),
          h(
            Row,
            {
              label: label('sound'),
              hint: label('soundHint'),
              disabled,
              onReset: isOverridden('sound') ? () => unset('sound') : null,
            },
            h(
              'select',
              {
                className: 'dn-select',
                disabled,
                value: form.sound || SOUND_DEFAULT,
                onChange: (event) => write('sound', event.target.value),
              },
              SOUND_OPTIONS.map(([value, key]) => h('option', { key: value, value }, label(key))),
            ),
          ),

          h('div', { className: 'dn-group' }, label('appearanceGroup')),
          h(
            Row,
            { label: label('theme'), hint: label('themeHint'), disabled },
            h(
              'select',
              {
                className: 'dn-select',
                disabled,
                value: form.theme || 'auto',
                onChange: (event) => write('theme', event.target.value),
              },
              [
                ['auto', label('themeAuto')],
                ['light', label('themeLight')],
                ['dark', label('themeDark')],
                ['system', label('themeSystem')],
              ].map(([value, text]) => h('option', { key: value, value }, text)),
            ),
          ),
          h(
            Row,
            { label: label('focusOnOpen'), hint: label('focusOnOpenHint'), disabled },
            h(Switch, {
              checked: Boolean(form.focusOnOpen),
              disabled,
              label: label('focusOnOpen'),
              onChange: (next) => write('focusOnOpen', next),
            }),
          ),

          h('div', { className: 'dn-group' }, label('timingGroup')),
          h(
            Row,
            {
              label: label('minTurnMs'),
              hint: label('minTurnMsHint'),
              disabled,
              onReset: isOverridden('minTurnMs') ? () => unset('minTurnMs') : null,
            },
            numberInput({
              value: msToSeconds(form.minTurnMs),
              disabled,
              unit: label('seconds'),
              placeholder: label('numberPlaceholder'),
              onChange: (next) => write('minTurnMs', secondsToMs(next)),
            }),
          ),
          h(
            Row,
            {
              label: label('infoTimeoutMs'),
              hint: label('infoTimeoutMsHint'),
              disabled,
              onReset: isOverridden('infoTimeoutMs') ? () => unset('infoTimeoutMs') : null,
            },
            numberInput({
              value: msToSeconds(form.infoTimeoutMs),
              disabled,
              unit: label('seconds'),
              placeholder: label('numberPlaceholder'),
              onChange: (next) => write('infoTimeoutMs', secondsToMs(next)),
            }),
          ),
          h(
            Row,
            {
              label: label('questionTimeoutMs'),
              hint: label('questionTimeoutMsHint'),
              disabled,
              onReset: isOverridden('questionTimeoutMs') ? () => unset('questionTimeoutMs') : null,
            },
            numberInput({
              value: msToSeconds(form.questionTimeoutMs),
              disabled,
              unit: label('seconds'),
              placeholder: label('numberPlaceholder'),
              onChange: (next) => write('questionTimeoutMs', secondsToMs(next)),
            }),
          ),
          h(
            Row,
            {
              label: label('maxBodyChars'),
              hint: label('maxBodyCharsHint'),
              disabled,
              onReset: isOverridden('maxBodyChars') ? () => unset('maxBodyChars') : null,
            },
            numberInput({
              value: form.maxBodyChars,
              disabled,
              unit: label('chars'),
              placeholder: label('numberPlaceholder'),
              onChange: (next) => write('maxBodyChars', next),
            }),
          ),

          h(
            Row,
            { label: label('language'), hint: label('languageHint'), disabled },
            h(
              'select',
              {
                className: 'dn-select',
                disabled,
                value: form.locale || 'zh',
                onChange: (event) => write('locale', event.target.value),
              },
              h('option', { value: 'zh' }, label('langZh')),
              h('option', { value: 'en' }, label('langEn')),
            ),
          ),

          h(
            'p',
            {
              className:
                'dn-flash' + (state.status === 'failed' ? ' dn-flash-err' : ''),
              role: 'status',
              'aria-live': 'polite',
            },
            state.status === 'saving' ? label('saving') : state.status === 'failed' ? label('failed') : state.status === 'saved' ? label('saved') : '',
          ),
        )
      }
    }

    /** Required services: slots + locale for the page, configForms for the writes. */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * Mount the Desktop notifications settings section.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      installStyles(ctx)
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-desktop-notifier: settings dictionaries')
      const host = ctx.configForms.get(ENTRY_ID)
      const sectionT = (key) => {
        try {
          return t(key)
        } catch {
          return key
        }
      }
      const Component = createSettingsSection(host, sectionT)
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'desktop-notifier',
            order: 42,
            label: () => t('nav'),
            locale: NS,
          },
          Component,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
