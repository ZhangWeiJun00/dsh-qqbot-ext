import { roleplayStore, roleplayRevision, importRoleplayCard, affectedRoleplayKeys } from '../../lib/roleplay.js'

const MAX_BODY = 5 * 1024 * 1024
function reply(res, status, body) {
  const payload = JSON.stringify(body)
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  if (res?.writeHead) { res.writeHead(status, headers); res.end(payload); return }
  return new Response(payload, { status, headers })
}
function trusted(req) {
  const origin = req.headers?.get?.('origin') ?? req.headers?.origin
  if (origin == null) return true
  try {
    const host = req.headers?.get?.('host') ?? req.headers?.host ?? new URL(req.url).host
    return new URL(origin).host === host
  } catch { return false }
}
async function bodyOf(req) {
  let raw
  if (typeof req?.[Symbol.asyncIterator] === 'function') {
    let size = 0
    const chunks = []
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_BODY) throw new Error('请求体过大')
      chunks.push(bytes)
    }
    raw = Buffer.concat(chunks).toString('utf8')
  } else raw = await req.text()
  if (Buffer.byteLength(raw) > MAX_BODY) throw new Error('请求体过大')
  return JSON.parse(raw || '{}')
}
export function register(ctx, store = roleplayStore) {
  ctx.webServer.register({ kind: 'exact', path: '/qqbot-ext/roleplay', async handler(req, res) {
    const method = String(req.method || 'GET').toUpperCase()
    if (!['GET', 'POST'].includes(method)) return reply(res, 405, { ok: false, error: '只支持 GET / POST' })
    if (!trusted(req)) return reply(res, 403, { ok: false, error: '来源不可信' })
    try {
      if (method === 'GET') {
        const config = await store.read()
        return reply(res, 200, { ok: true, config, revision: roleplayRevision(config) })
      }
      const body = await bodyOf(req)
      if (body.action === 'import') {
        if (body.name !== undefined && typeof body.name !== 'string') throw new Error('角色名称必须是文本')
        return reply(res, 200, { ok: true, card: importRoleplayCard(body.content, body.name) })
      }
      if (body.action !== undefined) throw new Error('未知操作')
      if (typeof body.revision !== 'string') throw new Error('缺少配置版本，请重新打开配置后保存')
      const previous = await store.read()
      const config = await store.write(body.config, body.revision)
      // 本地维护：人设变化的会话自动换新（消除旧人设历史影响）。轮换失败不影响
      // 保存结果；网关未启动（无 rotator 服务）时跳过，下次打开会话自然用新人设。
      let rotated = 0
      try {
        const rotator = ctx.get('qqbotExtSessionRotator')
        if (rotator && typeof rotator.knownKeys === 'function' && typeof rotator.rotate === 'function') {
          const affected = affectedRoleplayKeys(previous, config, rotator.knownKeys())
          for (const key of affected) { await rotator.rotate(key); rotated += 1 }
        }
      } catch (error) { console.warn('[dsh-qqbot-ext] 人设切换会话轮换失败（保存不受影响）：', error?.message ?? error) }
      return reply(res, 200, { ok: true, config, revision: roleplayRevision(config), rotated, message: rotated > 0 ? `人设已保存，${rotated} 个相关 QQ 会话已自动换新，下一轮生效` : '人设已保存，QQ 下一轮对话生效' })
    } catch (error) { return reply(res, error.status === 409 ? 409 : 400, { ok: false, error: String(error.message ?? error) }) }
  } })
}
