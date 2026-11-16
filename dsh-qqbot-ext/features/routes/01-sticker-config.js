// 「QQ 机器人扩展」配置页的 HTTP 接口：概览、组件清单、表情图库配置读写。
// 数据落在 ~/.dsh-qqbot-ext/config.json，保存即生效（无需重启 DSH）。
import { libraryDirOf, normalizeConfig, readConfig, writeConfig } from '../../lib/config.js'
import { describeComponents } from '../../lib/components.js'
import { mkdir, readdir } from 'node:fs/promises'

/** 主路径；旧路径保留为别名，避免用户书签失效。 */
const CONFIG_PATHS = ['/qqbot-ext/config', '/qqbot-ext/sticker-config']
const MAX_BODY_BYTES = 32 * 1024
const LIBRARY_FILE = /^[a-f0-9]{40}\.(png|jpe?g|gif|webp)$/i

/** 同源校验（Desktop 的 IPC 桥会去掉 origin 头，视作可信）。 */
function trusted(req) {
  const origin = req?.headers?.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  if (res && typeof res.writeHead === 'function') {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(payload)
    return undefined
  }
  return new Response(payload, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

async function readBody(req) {
  if (req && typeof req[Symbol.asyncIterator] === 'function') {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  if (typeof req?.json === 'function') return JSON.stringify(await req.json())
  return ''
}

async function countLibrary(dir) {
  const names = await readdir(dir).catch(() => null)
  if (names === null) return { exists: false, count: 0 }
  return { exists: true, count: names.filter((name) => LIBRARY_FILE.test(name)).length }
}

function collectorStatus(ctx) {
  try {
    return ctx.get('qqbotExtStickerCollector')?.status ?? undefined
  } catch {
    return undefined
  }
}

async function handleGet(res, ctx) {
  const config = await readConfig()
  const libraryDir = libraryDirOf(config)
  const { exists, count } = await countLibrary(libraryDir)
  const status = collectorStatus(ctx)
  return sendJson(res, 200, {
    ok: true,
    // 扩展概览
    version: '0.2.0',
    components: describeComponents(),
    capabilities: {
      autoCollect: config.enabled,
      collectMode: config.collectMode,
      stickerCount: count,
      stickerLimit: config.maxLibrary,
      pendingCount: Number(status?.pendingCount ?? 0),
      libraryExists: exists,
    },
    // 表情包图库这个组件的配置
    config,
    libraryDir,
    libraryExists: exists,
    count,
    // 全字段默认值，供页面上每个「恢复默认」按钮使用
    defaults: normalizeConfig({}, undefined),
    runtime: status === undefined ? undefined : {
      enabled: status.enabled,
      mode: status.mode,
      pendingCount: status.pendingCount,
      collected: status.collected,
      skipped: status.skipped,
      duplicates: status.duplicates,
      approved: status.approved,
      rejected: status.rejected,
    },
  })
}

async function handlePost(req, res, ctx) {
  if (!trusted(req)) return sendJson(res, 403, { ok: false, error: '来源不可信' })
  let payload
  try {
    payload = JSON.parse((await readBody(req)) || '{}')
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: `请求解析失败：${error instanceof Error ? error.message : String(error)}` })
  }
  try {
    const saved = await writeConfig(payload?.config ?? {})
    // 保存时顺手把目录建出来（选择器给的是已存在目录，手填新路径时这里兜底）
    const libraryDir = libraryDirOf(saved)
    await mkdir(libraryDir, { recursive: true }).catch(() => {})
    const { count } = await countLibrary(libraryDir)
    // 让收集器丢掉配置缓存，并通知后台判断器（刚配好模型时不用等下一张表情）
    try { ctx.get('qqbotExtStickerCollector')?.invalidate?.() } catch { /* 服务可能未就绪 */ }
    try { ctx.emit?.('qqbot-ext/config-updated', { config: saved }) } catch { /* 无人监听也无所谓 */ }
    return sendJson(res, 200, { ok: true, message: '设置已保存，立即生效', config: saved, libraryDir, count })
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

export function register(ctx) {
  for (const path of CONFIG_PATHS) {
    ctx.webServer.register({
      kind: 'exact',
      path,
      handler: (req, res) => {
        const method = String(req?.method ?? 'GET').toUpperCase()
        if (method === 'GET' || method === 'HEAD') return handleGet(res, ctx)
        if (method === 'POST') return handlePost(req, res, ctx)
        return sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
      },
    })
  }
}
