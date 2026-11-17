// 示例：Web 路由 —— GET /qqbot-ext/status 返回扩展状态 JSON。
// 路由形状照抄 dsh-qqbot bind-routes 的 { kind: 'exact', path, handler }。
// handler 兼容 node (req, res) 风格和 fetch 风格返回值两种宿主。
const STARTED_AT = new Date().toISOString()

export function register(ctx) {
  ctx.webServer.register({
    kind: 'exact',
    path: '/qqbot-ext/status',
    handler: (req, res) => {
      const body = JSON.stringify({
        ok: true,
        ext: 'dsh-qqbot-ext',
        startedAt: STARTED_AT,
        now: new Date().toISOString(),
      })
      if (res && typeof res.writeHead === 'function') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(body)
        return
      }
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    },
  })
}
