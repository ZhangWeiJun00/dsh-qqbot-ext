// 表情图库配置：单一事实源（宿主工具与 Web 配置页共用）。
// 存 %USERPROFILE%\.dsh-qqbot-ext\config.json，改了就即时生效，不用重启。
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'

export const HOME_DIR = join(homedir(), '.dsh-qqbot-ext')
export const CONFIG_PATH = join(HOME_DIR, 'config.json')
export const DEFAULT_LIBRARY_DIR = join(HOME_DIR, 'stickers')

export const CONFIG_DEFAULTS = {
  enabled: true,
  // 'auto'   = 照收不误（默认）
  // 'curated'= 先暂存，由模型看过图再决定要不要进图库
  collectMode: 'auto',
  libraryDir: DEFAULT_LIBRARY_DIR,
  minBytes: 1024,
  maxBytes: 6 * 1024 * 1024,
  minEdge: 48,
  maxEdge: 2048,
  maxAspect: 2,
  maxLibrary: 300,
  // 暂存区最多放多少张待判断的表情，超了丢最旧的，避免无人处理时无限涨。
  pendingLimit: 50,
  // 后台自动判断：只看图、按提示词决定收不收。留空 provider/model 就不启用。
  judgeEnabled: false,
  judgeProvider: '',
  judgeModel: '',
  // 判“想不想要”的标准放在这里，以后接人格模块改这段文字即可。
  judgePrompt: '',
  judgeMaxTokens: 200,
  judgeTimeoutMs: 60000,
}

/** 收集模式的合法取值。 */
export const COLLECT_MODES = ['auto', 'curated']

/** 展开 ~ / %VAR% 形式，其余原样返回。 */
export function expandPath(input) {
  const value = String(input ?? '').trim()
  if (value === '') return DEFAULT_LIBRARY_DIR
  let expanded = value
  if (expanded === '~') expanded = homedir()
  else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) expanded = join(homedir(), expanded.slice(2))
  expanded = expanded.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole)
  return expanded
}

function toInt(value, fallback, field, min, max) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${field} 必须是数字`)
  const rounded = Math.trunc(parsed)
  if (rounded < min || rounded > max) throw new Error(`${field} 需要在 ${min}–${max} 之间`)
  return rounded
}

/** 校验一份（可能是增量的）配置补丁，返回规范化后的已知字段。 */
export function normalizeConfig(patch, base) {
  const input = patch !== null && typeof patch === 'object' ? patch : {}
  const current = base ?? CONFIG_DEFAULTS
  const next = { ...current }

  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
    next.enabled = input.enabled
  }
  if (input.collectMode !== undefined) {
    if (!COLLECT_MODES.includes(input.collectMode)) {
      throw new Error(`collectMode 只能是 ${COLLECT_MODES.join(' / ')}`)
    }
    next.collectMode = input.collectMode
  }
  if (input.libraryDir !== undefined) {
    if (typeof input.libraryDir !== 'string') throw new Error('libraryDir 必须是字符串')
    const dir = expandPath(input.libraryDir)
    if (!isAbsolute(dir)) throw new Error('图库目录必须是绝对路径（可用 ~ 开头）')
    if (dir.length > 512) throw new Error('图库目录过长')
    next.libraryDir = dir
  }
  next.minBytes = toInt(input.minBytes, current.minBytes, 'minBytes', 0, 1_000_000_000)
  next.maxBytes = toInt(input.maxBytes, current.maxBytes, 'maxBytes', 1, 1_000_000_000)
  if (next.minBytes > next.maxBytes) throw new Error('最小字节不能大于最大字节')
  next.minEdge = toInt(input.minEdge, current.minEdge, 'minEdge', 1, 20000)
  next.maxEdge = toInt(input.maxEdge, current.maxEdge, 'maxEdge', 2, 20000)
  if (next.minEdge > next.maxEdge) throw new Error('最小边长不能大于最大边长')
  if (input.maxAspect !== undefined && input.maxAspect !== '' && input.maxAspect !== null) {
    const aspect = Number(input.maxAspect)
    if (!Number.isFinite(aspect)) throw new Error('maxAspect 必须是数字')
    if (aspect < 1 || aspect > 10) throw new Error('maxAspect 需要在 1–10 之间')
    next.maxAspect = Math.round(aspect * 100) / 100
  }
  next.maxLibrary = toInt(input.maxLibrary, current.maxLibrary, 'maxLibrary', 1, 10000)
  next.pendingLimit = toInt(input.pendingLimit, current.pendingLimit, 'pendingLimit', 0, 1000)

  if (input.judgeEnabled !== undefined) {
    if (typeof input.judgeEnabled !== 'boolean') throw new Error('judgeEnabled 必须是布尔值')
    next.judgeEnabled = input.judgeEnabled
  }
  for (const [key, field, limit] of [['judgeProvider', 'judgeProvider', 200], ['judgeModel', 'judgeModel', 200], ['judgePrompt', 'judgePrompt', 4000]]) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string') throw new Error(`${field} 必须是字符串`)
    if (input[key].length > limit) throw new Error(`${field} 不能超过 ${limit} 字符`)
    next[key] = input[key]
  }
  next.judgeMaxTokens = toInt(input.judgeMaxTokens, current.judgeMaxTokens, 'judgeMaxTokens', 16, 4000)
  next.judgeTimeoutMs = toInt(input.judgeTimeoutMs, current.judgeTimeoutMs, 'judgeTimeoutMs', 1000, 600000)
  return next
}

/**
 * 写入前的额外校验。放在这里而不是 normalizeConfig 里：
 * normalizeConfig 也被 readConfig 用，若在读取阶段抛错，
 * 一份写坏的配置会让 readConfig 整个退回默认值，把用户的其它设置也一起弄丢。
 */
export function assertWritable(next) {
  // 开了自动判断却没填 provider/model：与其静默失败，不如直接报错让人看见。
  if (next.judgeEnabled === true && next.collectMode === 'curated'
    && (String(next.judgeProvider ?? '').trim() === '' || String(next.judgeModel ?? '').trim() === '')) {
    throw new Error('开启后台自动判断前，先填好视觉模型的 provider 和 model')
  }
  return next
}

/** 后台判断是否真的可用（开关 + 模型都齐）。 */
export function judgeReady(config) {
  return config?.judgeEnabled === true && config?.collectMode === 'curated'
    && String(config?.judgeProvider ?? '').trim() !== ''
    && String(config?.judgeModel ?? '').trim() !== ''
}

/** 读磁盘配置；文件缺失或损坏时退回默认值，不抛错。 */
export async function readConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    return normalizeConfig(parsed, CONFIG_DEFAULTS)
  } catch {
    return { ...CONFIG_DEFAULTS }
  }
}

/** 合并写入（原子替换）；校验失败抛错，磁盘不动。 */
export async function writeConfig(patch) {
  const current = await readConfig()
  const next = assertWritable(normalizeConfig(patch, current))
  await mkdir(HOME_DIR, { recursive: true })
  const temp = `${CONFIG_PATH}.tmp`
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(temp, CONFIG_PATH)
  return next
}

/** 配置里的图库绝对路径。 */
export function libraryDirOf(config) {
  return expandPath(config?.libraryDir ?? DEFAULT_LIBRARY_DIR)
}

/**
 * 暂存区路径：curated 模式下，通过过滤但还没被模型判断的表情先放这里。
 * 放在图库旁边而不是图库里面，免得被 qq_list_stickers 当成正式表情列出来。
 */
export function pendingDirOf(config) {
  const library = libraryDirOf(config)
  return join(library, '..', `${basename(library)}.pending`)
}
