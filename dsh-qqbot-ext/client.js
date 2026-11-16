window.__ModuleLoader__.load({
  id: 'dsh-qqbot-ext',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API_PATH = '/qqbot-ext/config'
    const VISION_PATH = '/qqbot-ext/vision-models'
    const OPEN_FOLDER_PATH = '/qqbot-ext/open-folder'
    const STICKER_INDEX_PATH = '/qqbot-ext/sticker-index'
    const INDEX_DEFAULTS = {
      indexEnabled: false, indexProvider: '', indexModel: '', indexPrompt: '',
      indexMaxTokens: 1200, indexTimeoutMs: 60000,
      sameStickerCooldownSeconds: 600, stickerSendIntervalSeconds: 15,
    }
    const withIndexDefaults = (config) => config == null ? null : ({ ...INDEX_DEFAULTS, ...config })
    const STYLE_ID = 'qqbot-ext-panel-styles'
    const NS = 'dsh-qqbot-ext'
    const PANEL_ID = 'qqbot-ext'
    const TITLE = 'QQ 机器人扩展'

    /** 侧栏入口图标（currentColor 跟随主题与选中态）。 */
    function PanelIcon({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
      },
        h('path', {
          d: 'M12 2.6c4.6 0 8.4 3.4 8.4 7.6 0 1.6-.5 3-1.4 4.2 1.5.5 2.5 1.7 2.5 3.1 0 1.9-1.7 3.4-3.8 3.4-1 0-1.9-.3-2.6-.9-1 .5-2 .7-3.1.7-4.6 0-8.4-3.4-8.4-7.6S7.4 2.6 12 2.6Z',
          fill: 'currentColor', fillOpacity: 0.16,
        }),
        h('path', {
          d: 'M6.2 10.6c0-3.1 2.6-5.6 5.8-5.6 2.8 0 5.1 1.9 5.7 4.4.8-.2 1.5-.8 1.9-1.5.2-.4.9-.3 1 .2.2 1.9-.9 3.6-2.7 4.2-.4 2.4-2.6 4.2-5.4 4.2-3.5 0-6.3-2.6-6.3-5.9Z',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
        h('circle', { cx: 9.9, cy: 10.1, r: 0.9, fill: 'currentColor' }),
        h('path', {
          d: 'M11.4 14.4c.9.3 1.9.3 2.8 0',
          stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round',
        }))
    }

    function useStyles() {
      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined
        if (document.getElementById(STYLE_ID) !== null) return undefined
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = `

.qbe-configPanel[hidden] { display: none; }
.qbe-configTabs { position: sticky; top: 0; z-index: 2; padding: 10px 0;
  background: var(--dsw-alias-bg-layer-3, #202024); }
.qbe-configPanel { padding-bottom: 16px; }
.qbe-configPanel > .qbe-group { border-top: 0; padding-top: 8px; }
.qbe-advanced { margin: 12px 0; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 10px 12px; }
.qbe-advanced > summary { cursor: pointer; font-size: 13px; font-weight: 500; padding: 3px 0; }
.qbe-fieldGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 20px; }
.qbe-fieldGrid > .qbe-field { border-top: 0; }
.qbe-form > .qbe-footer { position: sticky; bottom: 0; z-index: 3; padding: 12px 0;
  background: var(--dsw-alias-bg-layer-3, #202024); }
@media (max-width: 600px) { .qbe-fieldGrid { grid-template-columns: 1fr; } .qbe-configTabs { gap: 2px; } .qbe-configTabs .qbe-tab { padding: 4px 8px; } }
.qbe-root { display: flex; flex-direction: column; min-width: 0; gap: 16px; }
.qbe-page { height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 24px clamp(16px, 4vw, 48px) 32px; color: var(--dsw-alias-label-primary); }
.qbe-pageInner { max-width: 960px; margin: 0 auto; }
.qbe-title { margin: 0; font-size: 18px; font-weight: 600; line-height: 26px; }
.qbe-subtitle { margin: 4px 0 0; font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-secondary); }
.qbe-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px; margin-top: 16px; }
.qbe-stat { border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.qbe-stat b { font-size: 16px; font-weight: 600; line-height: 22px; font-variant-numeric: tabular-nums; }
.qbe-stat span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.qbe-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2); padding-bottom: 10px; }
.qbe-tab { appearance: none; border: 0.5px solid transparent; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px;
  line-height: 20px; padding: 4px 12px; cursor: pointer; }
.qbe-tab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.qbe-tab[aria-selected='true'] { background: var(--dsw-alias-interactive-bg-active);
  border-color: var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); font-weight: 500; }
.qbe-tab:focus-visible, .qbe-save:focus-visible, .qbe-mini:focus-visible, .qbe-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
  var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.qbe-card { border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg, 12px);
  padding: 4px 16px 16px; margin-top: 12px; }
.qbe-cardHead { display: flex; align-items: flex-start; gap: 8px; padding: 14px 0 4px; }
.qbe-cardHead > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.qbe-cardHead h2 { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
.qbe-cardHead p { margin: 0; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); }
.qbe-form { display: flex; flex-direction: column; width: 100%; }
.qbe-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.qbe-field + .qbe-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.qbe-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.qbe-label { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary); }
.qbe-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.qbe-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere; }
.qbe-hint--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
.qbe-switch { box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px;
  padding: 2px; border: 0; border-radius: 999px; background: var(--dsw-alias-border-l3);
  cursor: pointer; font: inherit; }
.qbe-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.qbe-switch:disabled { cursor: default; opacity: .5; }
.qbe-thumb { display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #fff); transition: transform 120ms ease; }
.qbe-switch[aria-checked='true'] .qbe-thumb { transform: translateX(16px); }
.qbe-reset { flex: none; appearance: none; border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 11px; line-height: 16px; padding: 1px 9px; cursor: pointer;
  white-space: nowrap; }
.qbe-reset:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); }
.qbe-reset:disabled { opacity: .35; cursor: default; }
.qbe-reset:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid
  var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.qbe-input { box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); outline: none; }
.qbe-input:focus { border-color: var(--dsw-alias-state-business-primary); }
.qbe-select { appearance: none; padding-right: 28px; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 15px) calc(50% + 1px), calc(100% - 10px) calc(50% + 1px);
  background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; }
.qbe-select:disabled { opacity: .55; cursor: default; }
.qbe-label--sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.qbe-textarea { height: auto; padding: 8px 12px; resize: vertical; font-family: inherit;
  line-height: 1.6; min-height: 84px; }
.qbe-group { display: flex; flex-direction: column; gap: 14px; padding: 14px 0 2px;
  border-top: 0.5px solid var(--dsw-alias-border-l2); }
.qbe-groupHead { font-size: 12px; line-height: 18px; font-weight: 600;
  color: var(--dsw-alias-label-secondary); }
.qbe-pathRow { display: flex; gap: 8px; align-items: center; }
.qbe-pathRow .qbe-input { flex: 1; min-width: 0; }
.qbe-segmented { display: flex; gap: 0; border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 8px); overflow: hidden; width: fit-content; max-width: 100%; }
.qbe-segment { appearance: none; border: 0; border-left: 0.5px solid var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px;
  line-height: 1.5; padding: 6px 14px; cursor: pointer; }
.qbe-segment:first-child { border-left: 0; }
.qbe-segment:hover:not(:disabled):not(.qbe-segment--on) { background: var(--dsw-alias-interactive-bg-hover); }
.qbe-segment--on { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.qbe-segment:disabled { opacity: .5; cursor: default; }
.qbe-mini { flex: none; height: 34px; padding: 0 12px; border-radius: var(--dsw-radius-md, 8px);
  border: 0.5px solid var(--dsw-alias-border-l2); background: transparent; color: inherit;
  font: inherit; font-size: 13px; cursor: pointer; }
.qbe-mini:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.qbe-mini:disabled { opacity: .5; cursor: default; }
.qbe-footer { display: flex; align-items: center; gap: 8px; padding-top: 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2); margin-top: 2px; }
.qbe-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-tertiary); }
.qbe-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
.qbe-save { appearance: none; flex: none; border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px; font: inherit; font-size: 13px;
  line-height: 1.5; cursor: pointer; background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3); }
.qbe-save:disabled { opacity: .4; cursor: default; }
.qbe-toolList { display: flex; flex-direction: column; }
.qbe-tool { display: flex; flex-direction: column; gap: 2px; padding: 10px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2); }
.qbe-tool:first-child { border-top: 0; }
.qbe-tool code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  color: var(--dsw-alias-label-primary); }
.qbe-tool span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.qbe-empty { padding: 24px 0; text-align: center; font-size: 13px;
  color: var(--dsw-alias-label-tertiary); }
`
        document.head.appendChild(style)
        return () => { style.remove() }
      }, [])
    }

    function Switch({ checked, label, onChange, disabled }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
        className: 'qbe-switch', disabled: disabled === true,
        onClick: () => onChange(!checked),
      }, h('span', { className: 'qbe-thumb' }))
    }

    /** 单个字段的「恢复默认」按钮：已经是默认值时禁用。 */
    function ResetButton({ isDefault, onReset, disabled, label }) {
      return h('button', {
        type: 'button',
        className: 'qbe-reset',
        title: isDefault === true ? '已经是默认值' : '恢复这一项的默认值',
        'aria-label': `恢复默认：${label}`,
        disabled: disabled === true || isDefault === true,
        onClick: onReset,
      }, '恢复默认')
    }

    /** 数值字段（label + 恢复默认 + 输入 + 说明）。 */
    function NumberField({ label, help, value, defaultValue, disabled, onChange, onReset }) {
      const isDefault = String(value ?? '') === String(defaultValue ?? '')
      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h(ResetButton, { isDefault, onReset, disabled, label })),
        h('input', {
          className: 'qbe-input', value: String(value ?? ''), inputMode: 'numeric', spellCheck: false,
          disabled: disabled === true,
          onChange: (event) => onChange(event.currentTarget.value),
        }),
        help === undefined ? null : h('p', { className: 'qbe-hint' }, help))
    }

    /** 二选一分段控件：用于收集模式这类互斥选项。 */
    function Segmented({ label, help, value, defaultValue, options, disabled, onChange, onReset }) {
      const isDefault = value === defaultValue
      const current = options.find((option) => option.value === value)
      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h(ResetButton, { isDefault, onReset, disabled, label })),
        h('div', { className: 'qbe-segmented', role: 'radiogroup', 'aria-label': label },
          options.map((option) => h('button', {
            key: option.value,
            type: 'button',
            role: 'radio',
            'aria-checked': option.value === value,
            className: `qbe-segment${option.value === value ? ' qbe-segment--on' : ''}`,
            disabled: disabled === true,
            onClick: () => onChange(option.value),
          }, option.label))),
        current === undefined || current.help === undefined
          ? null
          : h('p', { className: 'qbe-hint' }, current.help))
    }

    /** 单行文本字段。 */
    function TextField({ label, help, value, defaultValue, disabled, onChange, onReset, placeholder }) {
      const isDefault = String(value ?? '') === String(defaultValue ?? '')
      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h(ResetButton, { isDefault, onReset, disabled, label })),
        h('input', {
          className: 'qbe-input', value: String(value ?? ''), spellCheck: false,
          placeholder: placeholder ?? '', disabled: disabled === true,
          onChange: (event) => onChange(event.currentTarget.value),
        }),
        help === undefined ? null : h('p', { className: 'qbe-hint' }, help))
    }

    /** 多行文本字段（判定提示词这种长文本用）。 */
    function TextAreaField({ label, help, value, defaultValue, disabled, onChange, onReset, placeholder }) {
      const isDefault = String(value ?? '') === String(defaultValue ?? '')
      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h(ResetButton, { isDefault, onReset, disabled, label })),
        h('textarea', {
          className: 'qbe-input qbe-textarea', value: String(value ?? ''), spellCheck: false,
          rows: 4, placeholder: placeholder ?? '', disabled: disabled === true,
          onChange: (event) => onChange(event.currentTarget.value),
        }),
        help === undefined ? null : h('p', { className: 'qbe-hint' }, help))
    }

    function ToolList({ tools }) {
      if (!Array.isArray(tools) || tools.length === 0) return null
      return h('div', { className: 'qbe-toolList' }, tools.map((tool) =>
        h('div', { className: 'qbe-tool', key: tool.name },
          h('code', null, tool.name),
          h('span', null, tool.description || '—'))))
    }

    /**
     * 视觉模型选择：自动探测宿主已注册的 provider / 能看图的模型。
     * 探测失败或该 provider 没广告模型时退回手填，功能不至于不可用。
     */
    function VisionModelPicker({ form, defaults, disabled, patch, resetTo, prefix = 'judge' }) {
      const providerKey = `${prefix}Provider`
      const modelKey = `${prefix}Model`
      const label = prefix === 'index' ? '索引视觉模型' : '视觉模型'
      const [catalog, setCatalog] = React.useState(null)
      const [note, setNote] = React.useState(null)

      const load = () => {
        setNote(null)
        setCatalog(null)
        fetch(VISION_PATH, { headers: { accept: 'application/json' } })
          .then((res) => res.json())
          .then((body) => {
            setCatalog(body)
            if (body?.ok !== true) setNote(body?.error ?? '没能读取模型列表，可以手填')
          })
          .catch((error) => {
            setCatalog({ ok: false, providers: [] })
            setNote(error instanceof Error ? error.message : String(error))
          })
      }

      React.useEffect(() => { load() }, [])

      const providers = Array.isArray(catalog?.providers) ? catalog.providers : []
      const providerId = form[providerKey] ?? ''
      const current = providers.find((item) => item.id === providerId)
      const candidates = (current?.models ?? []).filter((model) => model.vision === true)
      const allVision = providers.flatMap((item) => (item.models ?? []).filter((m) => m.vision === true))
      const loading = catalog === null
      const noVision = catalog !== null && allVision.length === 0

      const pickProvider = (event) => {
        const next = event.currentTarget.value
        patch(providerKey, next)
        // 换 provider 时原 model 多半不再适用，自动挑第一个能看图的
        const target = providers.find((item) => item.id === next)
        const firstVision = target?.models?.find((model) => model.vision === true)
        patch(modelKey, firstVision?.id ?? '')
      }

      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h('button', {
            type: 'button', className: 'qbe-mini', disabled: disabled === true,
            title: '重新读取宿主已注册的 provider 与模型',
            onClick: load,
          }, loading ? '读取中…' : '重新检测')),
        providers.length > 0
          ? h('div', { className: 'qbe-pathRow' },
            h('select', {
              className: 'qbe-input qbe-select', value: providerId, disabled: disabled === true,
              'aria-label': `${label} provider`, onChange: pickProvider,
            },
            h('option', { value: '' }, '— 选择 provider —'),
            providers.map((item) => h('option', { key: item.id, value: item.id }, item.id))),
            h('select', {
              className: 'qbe-input qbe-select', value: form[modelKey] ?? '',
              disabled: disabled === true,
              'aria-label': `${label} model`, onChange: (event) => patch(modelKey, event.currentTarget.value),
            },
            h('option', { value: '' }, '— 选择模型 —'),
            candidates.map((model) => h('option', { key: model.id, value: model.id },
              model.name === model.id ? model.id : `${model.name}（${model.id}）`))))
          : null,
        note === null ? null : h('p', { className: 'qbe-hint qbe-hint--error' }, `⚠️ ${note}`),
        h('div', { className: 'qbe-pathRow' },
            h('input', {
              className: 'qbe-input', value: providerId, spellCheck: false, disabled: disabled === true,
              placeholder: prefix === 'index' ? `留空沿用判断 provider：${form.judgeProvider || '未设置'}` : '手动填 provider，例如 easy-cliproxyapi',
              'aria-label': `${label} provider（手填）`,
              onChange: (event) => patch(providerKey, event.currentTarget.value),
            }),
            h('input', {
              className: 'qbe-input', value: form[modelKey] ?? '', spellCheck: false, disabled: disabled === true,
              placeholder: prefix === 'index' ? `留空沿用判断 model：${form.judgeModel || '未设置'}` : '手动填能看图的 model',
              'aria-label': `${label} model（手填）`,
              onChange: (event) => patch(modelKey, event.currentTarget.value),
            })),
        h('p', { className: 'qbe-hint' }, loading
          ? '正在从宿主读取已注册的模型…'
          : noVision
            ? '没探测到声明了图片输入的模型。在 settings 里补上 input: [text, image] 后再点「重新检测」，也可以直接手填。'
            : `不支持看图的模型已隐藏。当前：${form[providerKey] || (prefix === 'index' ? form.judgeProvider : '') || '—'} / ${form[modelKey] || (prefix === 'index' ? form.judgeModel : '') || '—'}`),
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label qbe-label--sub' }, '不选的话也可以手动指定'),
          h(ResetButton, {
            isDefault: `${form[providerKey] ?? ''}|${form[modelKey] ?? ''}` === `${defaults[providerKey] ?? ''}|${defaults[modelKey] ?? ''}`,
            onReset: () => { resetTo(providerKey)(); resetTo(modelKey)() },
            disabled: disabled, label,
          })))
    }

    /** 数据源：概览 + 组件清单 + 表情图库配置，一次拉齐。 */
    function useExtensionData() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      React.useEffect(() => {
        let stop = false
        fetch(API_PATH, { cache: 'no-store' }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const body = await res.json()
          if (body?.ok !== true) throw new Error(body?.error ?? '读取失败')
          if (!stop) { setData(body); setError(null) }
        }).catch((err) => { if (!stop) setError(err instanceof Error ? err.message : String(err)) })
        return () => { stop = true }
      }, [])
      return { data, setData, error }
    }

    /**
     * 调宿主的目录选择器（系统文件夹对话框）。
     *
     * 官方原生选择器（dsh-client-ui-directory-picker-native）的调法：
     * 优先 globalThis.__DSH_DIRECTORY_PICKER__（Desktop preload 注入），
     * 否则 ctx.uiWorkspace.pickDirectory()。这里依次尝试并把用了哪条路记下来，
     * 方便失败时看清到底缺什么，而不是只给一句“没有选择器”。
     */
    async function pickDirectory(getWorkspace) {
      const tried = []
      const desktop = globalThis.__DSH_DIRECTORY_PICKER__
      let workspace
      try {
        workspace = typeof getWorkspace === 'function' ? getWorkspace() : getWorkspace
      } catch (error) {
        tried.push(`uiWorkspace 取值抛错：${error instanceof Error ? error.message : String(error)}`)
        workspace = undefined
      }

      const candidates = [
        ['__DSH_DIRECTORY_PICKER__', typeof desktop?.pick === 'function' ? () => desktop.pick() : undefined],
        ['uiWorkspace.pickDirectory', typeof workspace?.pickDirectory === 'function' ? () => workspace.pickDirectory() : undefined],
      ]
      tried.push(`desktop=${desktop === undefined ? '无' : typeof desktop}, uiWorkspace=${workspace === undefined ? '无' : typeof workspace}`)

      for (const [name, pick] of candidates) {
        if (pick === undefined) continue
        try {
          const path = await pick()
          return {
            available: true,
            ok: true,
            via: name,
            path: path === null || path === undefined || path === '' ? null : String(path),
          }
        } catch (error) {
          return { available: true, ok: false, via: name, error: error instanceof Error ? error.message : String(error) }
        }
      }
      return { available: false, tried: tried.join('；') }
    }

    /** 图库索引管理与配置保存相互独立。 */
    function StickerIndexManager({ libraryDir }) {
      const [items, setItems] = React.useState([])
      const [status, setStatus] = React.useState(null)
      const [selected, setSelected] = React.useState('')
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const metadataOf = (item) => Object.fromEntries(
        ['text', 'description', 'emotions', 'scenes', 'avoid', 'confidence'].map((key) =>
          [key, item[key] ?? (['emotions', 'scenes', 'avoid'].includes(key) ? [] : key === 'confidence' ? 0 : '')]))
      const selectItem = (filename, list = items) => {
        setSelected(filename)
        const item = list.find((entry) => entry.filename === filename)
        setDraft(item ? JSON.stringify(metadataOf(item), null, 2) : '')
      }
      const request = async (body) => {
        const res = await fetch(STICKER_INDEX_PATH, body === undefined
          ? { cache: 'no-store', headers: { accept: 'application/json' } }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const result = await res.json().catch(() => ({}))
        if (!res.ok || result.ok !== true) throw new Error(result.error ?? `索引请求失败（HTTP ${res.status}）`)
        return result
      }
      const refresh = async (filename) => {
        const result = await request()
        const list = Array.isArray(result.items) ? result.items : []
        setItems(list)
        setStatus(result.status ?? null)
        selectItem(list.some((item) => item.filename === filename) ? filename : list[0]?.filename ?? '', list)
      }
      const perform = async (action) => {
        if (busy) return
        setBusy(true)
        setNote(null)
        try {
          let metadata
          if (action === 'update') {
            metadata = JSON.parse(draft)
            if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('元数据必须是 JSON 对象')
            for (const key of ['text', 'description']) {
              if (typeof metadata[key] !== 'string') throw new Error(`${key} 必须是字符串`)
            }
            for (const key of ['emotions', 'scenes', 'avoid']) {
              if (!Array.isArray(metadata[key]) || metadata[key].some((value) => typeof value !== 'string')) throw new Error(`${key} 必须是字符串数组`)
            }
            if (typeof metadata.confidence !== 'number' || !Number.isFinite(metadata.confidence) || metadata.confidence < 0 || metadata.confidence > 1) throw new Error('confidence 必须是 0 到 1 的数字')
            metadata = metadataOf(metadata)
          }
          if (action) await request({ action, ...(action === 'run' ? {} : { filename: selected }), ...(metadata ? { metadata } : {}) })
          await refresh(selected)
          setNote({ ok: true, message: action === 'update' ? '修正已保存' : action === 'retry' ? '已请求重新索引；可刷新查看进度' : action === 'run' ? '已请求补齐缺失索引；可刷新查看进度' : '列表已刷新' })
        } catch (error) {
          setNote({ ok: false, message: error instanceof Error ? error.message : String(error) })
        } finally { setBusy(false) }
      }
      React.useEffect(() => {
        let stopped = false
        setBusy(true)
        setNote(null)
        request().then((result) => {
          if (stopped) return
          const list = Array.isArray(result.items) ? result.items : []
          setItems(list)
          setStatus(result.status ?? null)
          selectItem(list[0]?.filename ?? '', list)
        }).catch((error) => {
          if (!stopped) setNote({ ok: false, message: error instanceof Error ? error.message : String(error) })
        }).finally(() => { if (!stopped) setBusy(false) })
        return () => { stopped = true }
      }, [libraryDir])
      return h('div', { className: 'qbe-group' },
        h('div', { className: 'qbe-groupHead' }, '图库索引管理'),
        h('p', { className: 'qbe-hint' }, '操作使用已保存的配置。刷新或切换图片会重新载入元数据，请先保存修正。'),
        h('div', { className: 'qbe-pathRow' },
          h('button', { type: 'button', className: 'qbe-mini', disabled: busy, onClick: () => perform() }, busy ? '处理中…' : '刷新列表'),
          h('button', { type: 'button', className: 'qbe-mini', disabled: busy, onClick: () => perform('run') }, '补齐缺失索引')),
        status === null ? null : h('pre', { className: 'qbe-hint', style: { whiteSpace: 'pre-wrap' } }, typeof status === 'string' ? status : JSON.stringify(status, null, 2)),
        note === null ? null : h('p', { role: note.ok ? 'status' : 'alert', className: `qbe-hint${note.ok ? '' : ' qbe-hint--error'}` }, note.message),
        h('label', { className: 'qbe-label', htmlFor: 'qbe-index-items' }, `图库图片（${items.length}）`),
        h('select', { id: 'qbe-index-items', className: 'qbe-input', size: 8,
          style: { height: 'auto', minHeight: '150px' }, value: selected, disabled: busy || items.length === 0,
          onChange: (event) => { selectItem(event.currentTarget.value); setNote(null) } },
          items.map((item) => h('option', { key: item.filename, value: item.filename }, `${item.filename}${item.manual ? ' · 人工修正' : ''}${item.description ? ` · ${item.description}` : ''}`))),
        items.length === 0 ? h('p', { className: 'qbe-hint' }, '暂无图片，请刷新或检查图库目录。') : null,
        h('label', { className: 'qbe-label', htmlFor: 'qbe-index-metadata' }, '所选图片元数据（JSON）'),
        h('textarea', { id: 'qbe-index-metadata', className: 'qbe-input qbe-textarea', rows: 14,
          style: { fontFamily: 'ui-monospace, monospace' }, value: draft, spellCheck: false,
          disabled: busy || !selected, onChange: (event) => { setDraft(event.currentTarget.value); setNote(null) } }),
        h('div', { className: 'qbe-pathRow' },
          h('button', { type: 'button', className: 'qbe-mini', disabled: busy || !selected, onClick: () => perform('update') }, '保存修正'),
          h('button', { type: 'button', className: 'qbe-mini', disabled: busy || !selected, onClick: () => perform('retry') }, '重新索引所选图片')))
    }

    /** 表情包图库组件：唯一可编辑的组件。 */
    function StickerLibrarySection({ data, setData, getWorkspace }) {
      const [initial, setInitial] = React.useState(() => withIndexDefaults(data.config))
      const [form, setForm] = React.useState(() => withIndexDefaults(data.config))
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [pickNote, setPickNote] = React.useState(null)
      const [opening, setOpening] = React.useState(false)
      const [tab, setTab] = React.useState('collect')

      React.useEffect(() => {
        setInitial(withIndexDefaults(data.config))
        setForm(withIndexDefaults(data.config))
      }, [data.config])

      const patch = (key, value) => {
        setForm((current) => ({ ...current, [key]: value }))
        setResult(null)
      }

      const submit = (event) => {
        event.preventDefault()
        if (busy || form === null) return
        setBusy(true)
        fetch(API_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config: form }),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (res.ok && body.ok === true) {
            setInitial(withIndexDefaults(body.config))
            setForm(withIndexDefaults(body.config))
            setData((current) => current === null ? current : {
              ...current,
              config: body.config,
              libraryDir: body.libraryDir,
              count: body.count,
              capabilities: { ...current.capabilities, stickerCount: body.count },
            })
            setResult({ ok: true, message: body.message ?? '设置已保存' })
            return
          }
          setResult({ ok: false, message: body.error ?? `保存失败（HTTP ${res.status}）` })
        }).catch((err) => {
          setResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
        }).then(() => { setBusy(false) })
      }

      // 打开系统文件夹选择器，选中即填回输入框（不直接落盘，仍需点保存）
      // 结果就近显示在路径下方，避免提示跑到表单最底部看不见。
      const chooseDir = () => {
        if (busy) return
        setBusy(true)
        setPickNote(null)
        pickDirectory(getWorkspace).then((picked) => {
          if (picked.available === false) {
            setPickNote({
              ok: false,
              message: `没能连上目录选择器，请直接手填路径。诊断：${picked.tried ?? '未知'}`,
            })
            return
          }
          if (picked.ok !== true) {
            setPickNote({ ok: false, message: `选择目录失败（${picked.via}）：${picked.error}` })
            return
          }
          if (picked.path === null || picked.path === undefined || picked.path === '') {
            setPickNote({ ok: true, message: '已取消选择' })
            return
          }
          patch('libraryDir', picked.path)
          setPickNote({ ok: true, message: `已选择：${picked.path}` })
        }).catch((error) => {
          setPickNote({ ok: false, message: `选择目录异常：${error instanceof Error ? error.message : String(error)}` })
        }).then(() => { setBusy(false) })
      }

      // 让宿主在系统文件管理器里打开图库目录（浏览器自己做不到）。
      // 打开的是已保存的生效目录，不是输入框里还没保存的值——避免"点了没反应"的错觉。
      const openFolder = () => {
        if (busy || opening) return
        setOpening(true)
        setPickNote(null)
        fetch(OPEN_FOLDER_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target: 'library' }),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (res.ok && body.ok === true) {
            setPickNote({ ok: true, message: `已在文件管理器打开：${body.dir}` })
            return
          }
          setPickNote({ ok: false, message: body.error ?? `打开失败（HTTP ${res.status}）` })
        }).catch((error) => {
          setPickNote({ ok: false, message: `打开目录异常：${error instanceof Error ? error.message : String(error)}` })
        }).then(() => { setOpening(false) })
      }

      if (form === null) return h('div', { className: 'qbe-empty' }, '正在读取配置…')
      const dirty = JSON.stringify(form) !== JSON.stringify(initial)
      const defaults = { ...INDEX_DEFAULTS, ...data.defaults }
      const resetTo = (key) => () => {
        if (defaults[key] === undefined) return
        patch(key, defaults[key])
      }

      const sections = [['collect', '收集设置'], ['index', '图片理解'], ['send', '发送设置'], ['library', '图库管理']]
      const panel = (id, ...children) => h('div', { key: id, id: `qbe-panel-${id}`, role: 'tabpanel', 'aria-labelledby': `qbe-tab-${id}`, hidden: tab !== id, className: 'qbe-configPanel' }, ...children)
      return h('form', { className: 'qbe-form', onSubmit: submit },
        h('div', { className: 'qbe-tabs qbe-configTabs', role: 'tablist', 'aria-label': '图库设置分类' },
          sections.map(([id, label]) => h('button', { key: id, id: `qbe-tab-${id}`, type: 'button', role: 'tab',
            className: 'qbe-tab', 'aria-selected': tab === id, 'aria-controls': `qbe-panel-${id}`,
            onClick: () => setTab(id) }, label))),
        panel('collect',
        h('div', { className: 'qbe-field' },
          h('div', { className: 'qbe-head' },
            h('span', { className: 'qbe-label' }, '自动收集别人发的表情包'),
            h(ResetButton, {
              isDefault: (form.enabled === true) === (defaults.enabled === true),
              onReset: resetTo('enabled'), disabled: busy, label: '自动收集',
            }),
            h(Switch, { checked: form.enabled === true, label: '自动收集', onChange: (v) => patch('enabled', v) })),
          h('p', { className: 'qbe-help' }, '只收 QQ 明确标成表情、且同一条消息只有一张图片的；普通照片不收。')),
        h(Segmented, {
          label: '收集方式',
          value: form.collectMode ?? 'auto',
          defaultValue: defaults.collectMode ?? 'auto',
          disabled: busy,
          onChange: (v) => patch('collectMode', v),
          onReset: resetTo('collectMode'),
          options: [
            {
              value: 'auto',
              label: '全收',
              help: '过了过滤条件就直接进图库，不问模型。',
            },
            {
              value: 'curated',
              label: '模型判断',
              help: '先放进暂存区，看过图觉得有意思才收进图库。暂存超过上限会自动丢最旧的。',
            },
          ],
        }),
        h('div', { className: 'qbe-field' },
          h('div', { className: 'qbe-head' },
            h('span', { className: 'qbe-label' }, '图库保存位置'),
            h(ResetButton, {
              isDefault: (form.libraryDir ?? '') === (defaults.libraryDir ?? ''),
              onReset: resetTo('libraryDir'), disabled: busy, label: '图库保存位置',
            })),
          h('div', { className: 'qbe-pathRow' },
            h('input', {
              className: 'qbe-input', value: form.libraryDir ?? '', spellCheck: false,
              placeholder: defaults.libraryDir ?? '',
              onChange: (event) => patch('libraryDir', event.currentTarget.value),
            }),
            h('button', {
              type: 'button', className: 'qbe-mini', disabled: busy,
              title: '打开系统文件夹选择框',
              onClick: chooseDir,
            }, busy ? '选择中…' : '选择目录'),
            h('button', {
              type: 'button', className: 'qbe-mini', disabled: busy || opening,
              title: '在文件管理器里打开图库目录',
              onClick: openFolder,
            }, opening ? '打开中…' : '打开目录')),
          pickNote === null ? null : h('p', {
            className: `qbe-hint${pickNote.ok ? '' : ' qbe-hint--error'}`,
          }, (pickNote.ok ? '' : '⚠️ ') + pickNote.message),
          h('p', { className: 'qbe-hint' },
            `当前生效：${data.libraryDir ?? '—'}（${data.count ?? 0} 张${data.libraryExists === false ? '，目录还没建' : ''}）。支持 ~ 与 %VAR%，保存后立即生效，不用重启。`)),
        h(NumberField, {
          label: '张数上限', value: form.maxLibrary, defaultValue: defaults.maxLibrary,
          onChange: (v) => patch('maxLibrary', v), onReset: resetTo('maxLibrary'), disabled: busy,
          help: '图库到达上限后不再收新的。',
        }),
        h(NumberField, {
          label: '暂存上限', value: form.pendingLimit, defaultValue: defaults.pendingLimit,
          onChange: (v) => patch('pendingLimit', v), onReset: resetTo('pendingLimit'), disabled: busy,
          help: '只在「模型判断」模式下有用：暂存区满了丢最旧的，0 表示不留。',
        }),
        h('details', { className: 'qbe-advanced' },
          h('summary', null, '模型筛选设置（仅模型判断模式）'),
          h('div', { className: 'qbe-field' },
            h('div', { className: 'qbe-head' },
              h('span', { className: 'qbe-label' }, '开启后台自动判断'),
              h(ResetButton, {
                isDefault: (form.judgeEnabled === true) === (defaults.judgeEnabled === true),
                onReset: resetTo('judgeEnabled'), disabled: busy, label: '开启后台自动判断',
              }),
              h(Switch, {
                checked: form.judgeEnabled === true, label: '后台自动判断',
                onChange: (v) => patch('judgeEnabled', v),
              })),
            h('p', { className: 'qbe-help' },
              '开启后，新表情会排队交给视觉模型逐张看，按下面的判定提示词决定收还是丢。关着就完全不调用模型。')),
          h(VisionModelPicker, {
            form, defaults, disabled: busy, patch, resetTo,
          }),
          h(TextAreaField, {
            label: '判定提示词', value: form.judgePrompt, defaultValue: defaults.judgePrompt,
            onChange: (v) => patch('judgePrompt', v), onReset: resetTo('judgePrompt'), disabled: busy,
            placeholder: '留空则用内置默认提示词',
            help: '模型的审美标准就写在这里。以后接了人格/人设模块，改这段文字就行，不用动代码。要求模型第一行回 KEEP 或 DROP。',
          }),
          h(NumberField, {
            label: '判断输出 token 上限', value: form.judgeMaxTokens, defaultValue: defaults.judgeMaxTokens,
            onChange: (v) => patch('judgeMaxTokens', v), onReset: resetTo('judgeMaxTokens'), disabled: busy,
          }),
          h(NumberField, {
            label: '判断超时（毫秒）', value: form.judgeTimeoutMs, defaultValue: defaults.judgeTimeoutMs,
            onChange: (v) => patch('judgeTimeoutMs', v), onReset: resetTo('judgeTimeoutMs'), disabled: busy,
            help: '单张图最多等这么久，超时就跳过、留在暂存区下次再判。',
          })),
          h('details', { className: 'qbe-advanced' }, h('summary', null, '高级过滤设置'),
            h('div', { className: 'qbe-fieldGrid' },
        h(NumberField, {
          label: '最小字节', value: form.minBytes, defaultValue: defaults.minBytes,
          onChange: (v) => patch('minBytes', v), onReset: resetTo('minBytes'), disabled: busy,
          help: '太小的是图标，挡掉。',
        }),
        h(NumberField, {
          label: '最大字节', value: form.maxBytes, defaultValue: defaults.maxBytes,
          onChange: (v) => patch('maxBytes', v), onReset: resetTo('maxBytes'), disabled: busy,
          help: '太大的是照片或动图，挡掉。',
        }),
        h(NumberField, {
          label: '最小长边（像素）', value: form.minEdge, defaultValue: defaults.minEdge,
          onChange: (v) => patch('minEdge', v), onReset: resetTo('minEdge'), disabled: busy,
        }),
        h(NumberField, {
          label: '最大长边（像素）', value: form.maxEdge, defaultValue: defaults.maxEdge,
          onChange: (v) => patch('maxEdge', v), onReset: resetTo('maxEdge'), disabled: busy,
        }),
        h(NumberField, {
          label: '最大长宽比', value: form.maxAspect, defaultValue: defaults.maxAspect,
          onChange: (v) => patch('maxAspect', v), onReset: resetTo('maxAspect'), disabled: busy,
          help: '2 表示长边最多是短边的两倍，太长的截图会被挡掉。',
        })))),
        panel('index',
        h('div', { className: 'qbe-group' },
          h('div', { className: 'qbe-groupHead' }, '图片内容索引（全收与模型判断模式均可使用）'),
          h('div', { className: 'qbe-field' },
            h('div', { className: 'qbe-head' },
              h('span', { className: 'qbe-label' }, '开启图片索引'),
              h(ResetButton, { isDefault: form.indexEnabled === defaults.indexEnabled,
                onReset: resetTo('indexEnabled'), disabled: busy, label: '图片索引' }),
              h(Switch, { checked: form.indexEnabled === true, label: '图片索引', disabled: busy,
                onChange: (value) => patch('indexEnabled', value) })),
            h('p', { className: 'qbe-help' }, '为图库图片生成文字、描述和场景标签，独立于收集模式。默认关闭。')),
          h(VisionModelPicker, { form, defaults, disabled: busy, patch, resetTo, prefix: 'index' }),
          h('p', { className: 'qbe-hint' }, '索引 provider 与 model 分别留空时，沿用后台判断的对应配置。'),
          h(TextAreaField, { label: '索引提示词', value: form.indexPrompt, defaultValue: defaults.indexPrompt,
            onChange: (value) => patch('indexPrompt', value), onReset: resetTo('indexPrompt'), disabled: busy,
            placeholder: '留空使用内置索引提示词' }),
          h(NumberField, { label: '索引输出 token 上限', value: form.indexMaxTokens, defaultValue: defaults.indexMaxTokens,
            onChange: (value) => patch('indexMaxTokens', value), onReset: resetTo('indexMaxTokens'), disabled: busy }),
          h(NumberField, { label: '索引超时（毫秒）', value: form.indexTimeoutMs, defaultValue: defaults.indexTimeoutMs,
            onChange: (value) => patch('indexTimeoutMs', value), onReset: resetTo('indexTimeoutMs'), disabled: busy }))),
        panel('send',
        h('div', { className: 'qbe-group' },
          h('div', { className: 'qbe-groupHead' }, '表情发送冷却'),
          h(NumberField, { label: '同一张表情冷却（秒）', value: form.sameStickerCooldownSeconds,
            defaultValue: defaults.sameStickerCooldownSeconds, disabled: busy,
            onChange: (value) => patch('sameStickerCooldownSeconds', value), onReset: resetTo('sameStickerCooldownSeconds'),
            help: '默认 600 秒，0 表示关闭同图冷却。' }),
          h(NumberField, { label: '表情发送间隔（秒）', value: form.stickerSendIntervalSeconds,
            defaultValue: defaults.stickerSendIntervalSeconds, disabled: busy,
            onChange: (value) => patch('stickerSendIntervalSeconds', value), onReset: resetTo('stickerSendIntervalSeconds'),
            help: '默认 15 秒，0 表示关闭发送间隔限制。' }))),
        panel('library', h(StickerIndexManager, { libraryDir: data.libraryDir })),
        h('div', { className: 'qbe-footer' },
          result !== null
            ? h('p', { className: `qbe-note${result.ok ? '' : ' qbe-note--error'}` }, (result.ok ? '' : '⚠️ ') + result.message)
            : h('p', { className: 'qbe-note' }, dirty ? '有改动还没保存' : ''),
          h('button', {
            type: 'button', className: 'qbe-mini', disabled: busy,
            title: '把所有项都恢复成默认值',
            onClick: () => { setForm({ ...defaults }); setResult(null) },
          }, '全部恢复'),
          h('button', { className: 'qbe-save', type: 'submit', disabled: busy || !dirty },
            busy ? '保存中…' : '保存')))
    }

    /** 只读组件页：说明 + 用到的工具。 */
    function ReadonlySection({ component }) {
      return h('div', null,
        h('div', { className: 'qbe-field' }, h('p', { className: 'qbe-help' }, component.summary)),
        h(ToolList, { tools: component.toolInfo }))
    }

    /** 总页：概览 + 组件切换。设置页与主面板共用同一份。 */
    function ExtensionPanel({ embedded, getWorkspace }) {
      useStyles()
      const { data, setData, error } = useExtensionData()
      const [active, setActive] = React.useState('sticker-library')

      if (error !== null) {
        return h('div', { className: 'qbe-root' },
          h('p', { className: 'qbe-note qbe-note--error' }, `读取扩展状态失败：${error}`))
      }
      if (data === null) return h('div', { className: 'qbe-empty' }, '正在读取扩展状态…')

      const components = Array.isArray(data.components) ? data.components : []
      const current = components.find((item) => item.id === active) ?? components[0]

      const overview = embedded === true ? null : h('div', null,
        h('h1', { className: 'qbe-title' }, TITLE),
        h('p', { className: 'qbe-subtitle' },
          'QQ 机器人扩展：表情包图库、QQ 表情检索和调试工具。改动即时生效，不用重启。'),
        h('div', { className: 'qbe-stats' },
          h('div', { className: 'qbe-stat' },
            h('b', null, String(data.capabilities?.stickerCount ?? 0)),
            h('span', null, `图库张数（上限 ${data.capabilities?.stickerLimit ?? '—'}）`)),
          h('div', { className: 'qbe-stat' },
            h('b', null, data.capabilities?.autoCollect === true ? '开' : '关'),
            h('span', null, '自动收集')),
          h('div', { className: 'qbe-stat' },
            h('b', null, String(components.length)),
            h('span', null, '组件个数')),
          h('div', { className: 'qbe-stat' },
            h('b', null, String(data.version ?? '—')),
            h('span', null, '版本'))))

      return h('div', { className: 'qbe-root' },
        overview,
        h('div', { className: 'qbe-tabs', role: 'tablist', 'aria-label': '扩展组件' },
          components.map((item) => h('button', {
            key: item.id, type: 'button', role: 'tab',
            'aria-selected': item.id === (current?.id ?? ''),
            className: 'qbe-tab',
            onClick: () => setActive(item.id),
          }, item.title))),
        current === undefined
          ? h('div', { className: 'qbe-empty' }, '这个扩展还没有可配置的组件')
          : h('div', { className: 'qbe-card' },
            h('div', { className: 'qbe-cardHead' },
              h('div', null,
                h('h2', null, current.title),
                h('p', null, current.summary))),
            current.editable === true
              ? h(StickerLibrarySection, { data, setData, getWorkspace })
              : h(ReadonlySection, { component: current })))
    }

    /** 主面板页面容器（layout.selectPanel 目标）。 */
    function ExtensionPage({ getWorkspace }) {
      return h('div', { className: 'qbe-page' },
        h('div', { className: 'qbe-pageInner' },
          h(ExtensionPanel, { embedded: false, getWorkspace })))
    }

    /** 设置页栏目（外壳已有标题，不再重复大标题）。 */
    function ExtensionSettingsSection({ getWorkspace }) {
      return h(ExtensionPanel, { embedded: true, getWorkspace })
    }

    return {
      // 只声明 slots：面板必须无条件加载。
      // uiWorkspace 不能写进硬依赖——它是可选服务（官方 picker 的 inject 依赖它，
      // 但那是那个插件自己的组合假设）；这里若声明，服务缺失就整个面板不激活，
      // 页面直接消失，比“选不了目录”严重得多。改为点击时惰性取。
      name: NS + '-panel',
      inject: ['slots'],
      apply(ctx) {
        let workspaceCache
        let workspaceProbed = false
        const getWorkspace = () => {
          if (workspaceProbed) return workspaceCache
          workspaceProbed = true
          try {
            workspaceCache = ctx.get('uiWorkspace')
          } catch {
            workspaceCache = undefined
          }
          return workspaceCache
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'qqbot-ext',
          order: 60,
          label: () => TITLE,
          inject: () => ({ getWorkspace }),
        }, ExtensionSettingsSection))

        const inject = ctx.inject
        if (typeof inject !== 'function') return
        inject.call(ctx, ['layout'], (pageCtx) => {
          const pageSlots = pageCtx.slots
          if (pageSlots === undefined) return undefined
          const stopMain = pageSlots.inject('main', () => pageSlots.register({
            name: 'main',
            key: PANEL_ID,
            inject: () => ({ getWorkspace }),
          }, ExtensionPage))
          let stopEntry
          try {
            stopEntry = pageSlots.inject('sidebar.panellist', () => pageSlots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 40,
              label: () => TITLE,
            }, PanelIcon))
          } catch (error) {
            stopMain()
            throw error
          }
          return () => {
            stopEntry()
            stopMain()
          }
        })
      },
    }
  },
})
