// 错误拦截与熔断（本地维护）：
// - 回合错误：原会话只发友好短提示（正文可配，留空静默），技术详情全部转发管理员 c2c；
// - 全局熔断：连续 N 个错误回合后跳闸，期间新消息不进模型（每会话节流友好提示）；
//   **无冷却、不自动恢复**——只能由管理员发 /resume 人工合闸；
// - 跳闸事件通知管理员。斜杠命令与待答问题在闸门之前处理，不受熔断影响。
// 状态为模块级（单 bot 进程）；配置实时读 ~/.dsh-qqbot-ext/config.json，
// 测试可直接传 cfg 覆盖，避免真实文件 I/O。
import { readFileSync } from 'node:fs'
import { CONFIG_PATH, readConfig } from './config.js'

const NOTICE_INTERVAL_MS = 60000
const state = { consecutive: 0, trippedAt: 0, lastNotice: new Map() }

/** 测试钩子：清空熔断状态。 */
export function _resetErrorGuard() {
  state.consecutive = 0
  state.trippedAt = 0
  state.lastNotice.clear()
}

/** 观测：当前连续错误数与跳闸时刻（0 = 未跳闸）。 */
export function breakerState() {
  return { consecutive: state.consecutive, trippedAt: state.trippedAt }
}

function adminOpenid(cfg, fallbackAdmin) {
  const explicit = String(cfg.errorForwardOpenid ?? '').trim()
  return explicit || String(fallbackAdmin ?? '').trim()
}

/** 同步解析管理员 openid：errorForwardOpenid 优先，否则官方 c2c 白名单第一个。
 *  SDK 的 authorized 是同步判定（不 await），只能同步 IO；读失败回退白名单首项。 */
function adminOpenidSync(config, cfg) {
  let extCfg = cfg
  if (extCfg === undefined) {
    try { extCfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '')) } catch { extCfg = {} }
  }
  const explicit = String(extCfg?.errorForwardOpenid ?? '').trim()
  return explicit || String(config?.access?.c2cAllow?.[0] ?? '').trim()
}

/** /resume 仅限管理员：发送者必须等于管理员 openid；解析不出管理员时一律拒绝（fail-closed）。 */
export function adminOnlyAuth({ config, logger, cfg }) {
  return (ctx) => {
    const admin = adminOpenidSync(config, cfg)
    const sender = String(ctx?.message?.senderId ?? '')
    if (admin && sender === admin) return true
    logger?.warn?.(`[dsh-qqbot-ext] /resume denied: sender=${sender || '(missing)'} admin=${admin || '(unset)'}`)
    return '⚠️ 该命令仅限管理员使用'
  }
}

async function forward(sendTo, cfg, fallbackAdmin, text, logger) {
  const openid = adminOpenid(cfg, fallbackAdmin)
  if (!openid) return false
  try {
    await sendTo({ scope: 'c2c', targetId: openid }, text)
    return true
  } catch (error) {
    logger?.warn?.(`[dsh-qqbot-ext] 错误转发管理员失败：${error?.message ?? error}`)
    return false
  }
}

async function resolveCfg(cfg) {
  return cfg ?? await readConfig()
}

/**
 * 回合错误拦截：详情转发管理员 + 原会话友好提示 + 熔断计数。
 * sendTo(target, text) 由调用方提供（outbound 的切分发送）。
 * 已跳闸时在途回合的错误照常上报，但不重复跳闸通知、不改变跳闸时刻。
 * 返回 { guarded, justTripped }。
 */
export async function interceptTurnError({ failure, sessionKey, scope, peerId, sendTo, fallbackAdmin, logger, cfg, now = Date.now() }) {
  const config = await resolveCfg(cfg)
  if (config.errorGuardEnabled !== true) return { guarded: false, justTripped: false }
  const when = new Date(now).toLocaleString('zh-CN', { hour12: false })
  await forward(sendTo, config, fallbackAdmin,
    `⚠️ QQ 模型回合错误\n会话：${sessionKey}\n时间：${when}\n错误：${failure.code}: ${failure.message}`, logger)
  const notice = String(config.errorNoticeText ?? '').trim()
  if (notice && peerId) {
    try {
      await sendTo({ scope, targetId: peerId }, notice)
    } catch (error) {
      logger?.warn?.(`[dsh-qqbot-ext] 错误提示发送失败：${error?.message ?? error}`)
    }
  }
  state.consecutive += 1
  const threshold = Number(config.breakerThreshold ?? 0)
  let justTripped = false
  if (threshold > 0 && state.consecutive >= threshold && state.trippedAt === 0) {
    state.trippedAt = now
    justTripped = true
    await forward(sendTo, config, fallbackAdmin,
      `🔴 熔断触发：连续 ${state.consecutive} 个回合错误，已暂停模型调用。无自动恢复——请管理员发送 /resume 人工合闸。`, logger)
  }
  return { guarded: true, justTripped }
}

/**
 * 回合成功：未跳闸时清零连续计数。
 * 已跳闸时不做任何事——合闸只能由管理员 /resume 触发（在途成功回合不自动恢复）。
 */
export async function noteTurnSuccess({ cfg } = {}) {
  await resolveCfg(cfg)
  if (state.trippedAt > 0) return
  state.consecutive = 0
}

/**
 * 熔断闸门（入站中间件用）：跳闸后一律返回 true（消息不进模型），
 * 并按会话节流发送友好提示（正文留空则完全静默）。无冷却，直到人工合闸。
 */
export async function breakerGate({ sessionKey, scope, peerId, sendTo, logger, cfg, now = Date.now() }) {
  const config = await resolveCfg(cfg)
  if (config.errorGuardEnabled !== true) return false
  const threshold = Number(config.breakerThreshold ?? 0)
  if (threshold <= 0 || state.trippedAt === 0) return false
  const notice = String(config.errorNoticeText ?? '').trim()
  const last = state.lastNotice.get(sessionKey) ?? 0
  if (notice && peerId && now - last >= NOTICE_INTERVAL_MS) {
    if (state.lastNotice.size > 500) state.lastNotice.clear()
    state.lastNotice.set(sessionKey, now)
    try {
      await sendTo({ scope, targetId: peerId }, notice)
    } catch (error) {
      logger?.warn?.(`[dsh-qqbot-ext] 熔断提示发送失败：${error?.message ?? error}`)
    }
  }
  return true
}

/** 人工合闸：立即清除跳闸与连续错误计数（/resume，白名单管理员）。 */
export function manualResetBreaker() {
  const wasTripped = state.trippedAt > 0
  const consecutive = state.consecutive
  state.consecutive = 0
  state.trippedAt = 0
  return { wasTripped, consecutive }
}

/** 熔断状态视图（/resume status 查询用）。 */
export function breakerStatus(cfg) {
  return {
    enabled: cfg.errorGuardEnabled === true,
    threshold: Number(cfg.breakerThreshold ?? 0),
    consecutive: state.consecutive,
    tripped: state.trippedAt > 0,
    trippedAt: state.trippedAt,
  }
}

/**
 * /resume 命令（仅限管理员，adminOnlyAuth 由调用方注入）：
 * 无参数直接人工合闸（唯一恢复途径）；status 查状态。命令在熔断闸门之前处理，跳闸期间可用。
 * 保留 breaker 别名与 reset/resume 参数兼容旧用法。
 */
export function breakerCommand({ config, logger, authorized, cfg }) {
  return {
    name: ['resume', 'breaker'],
    category: 'agent',
    scope: 'all',
    authorized,
    description: '人工合闸恢复熔断：/resume 立即恢复，/resume status 查看状态',
    handler: async (cmdCtx) => {
      const args = String(cmdCtx.command?.raw ?? '').trim().toLowerCase()
      if (args === '' || args === 'reset' || args === 'resume') {
        const { wasTripped, consecutive } = manualResetBreaker()
        logger?.info?.(`[dsh-qqbot-ext] breaker manual reset: wasTripped=${wasTripped} consecutive=${consecutive}`)
        return wasTripped ? '🟢 已人工合闸，恢复正常模型调用 ✓' : '当前没有跳闸，错误计数已清零 ✓'
      }
      if (args !== 'status') return '用法：/resume 人工合闸，/resume status 查看状态'
      const liveCfg = cfg ?? await readConfig()
      const s = breakerStatus(liveCfg)
      if (!s.enabled) return '错误拦截已关闭（面板「错误拦截」可开启）'
      if (s.threshold <= 0) return `熔断未启用（阈值为 0）；连续错误 ${s.consecutive} 次`
      if (!s.tripped) return `🟢 熔断状态：正常\n连续错误 ${s.consecutive}/${s.threshold}`
      const when = new Date(s.trippedAt).toLocaleString('zh-CN', { hour12: false })
      return `🔴 熔断中（${when} 跳闸），已暂停模型调用\n连续错误 ${s.consecutive}/${s.threshold}\n无自动恢复，人工合闸：/resume`
    },
  }
}