// GET /qqbot-ext/vision-models —— 自动探测宿主已注册的 provider，以及其中能看图的模型。
//
// 数据全部来自宿主的 llm 服务，不在本地存一份清单：
//   llm.listProviders()        已注册的 provider 路由
//   llm.listModels(provider)   该 provider 广告的模型，含 inputModalities
//
// 只把 inputModalities 含 'image' 的模型标成 vision=true，配置页据此给出可选项，
// 用户不用再手抄 provider / model id。
import { readConfig } from '../../lib/config.js'

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  if (res && typeof res.writeHead === 'function') {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(payload)
    return undefined
  }
  return new Response(payload, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

/** provider 可能是字符串，也可能是 { id/name } 形状；统一成字符串。 */
function providerId(entry) {
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object') {
    for (const key of ['id', 'name', 'provider']) {
      if (typeof entry[key] === 'string' && entry[key] !== '') return entry[key]
    }
  }
  return undefined
}

/** 从模型元数据里判断能不能看图。 */
function canSeeImages(model) {
  const modalities = model?.inputModalities ?? model?.input ?? model?.modalities
  if (Array.isArray(modalities)) return modalities.map((m) => String(m).toLowerCase()).includes('image')
  // 没给模态信息时不敢断言支持，交给用户自己判断
  return false
}

async function discover(llm) {
  const providers = []
  let raw = []
  try {
    raw = (await llm.listProviders()) ?? []
  } catch {
    return { providers, error: '宿主 llm 服务列不出 provider' }
  }
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = providerId(entry)
    if (id === undefined) continue
    let models = []
    try {
      models = (await llm.listModels(id)) ?? []
    } catch {
      models = []
    }
    providers.push({
      id,
      models: (Array.isArray(models) ? models : []).map((model) => ({
        id: String(model?.id ?? ''),
        name: String(model?.name ?? model?.id ?? ''),
        vision: canSeeImages(model),
      })).filter((model) => model.id !== ''),
    })
  }
  return { providers }
}

export function register(ctx) {
  ctx.webServer.register({
    kind: 'exact',
    path: '/qqbot-ext/vision-models',
    handler: async (req, res) => {
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: '只支持 GET' })
      }
      let llm
      try {
        llm = ctx.get('llm')
      } catch {
        llm = undefined
      }
      if (typeof llm?.listProviders !== 'function') {
        return sendJson(res, 200, {
          ok: false,
          providers: [],
          error: '宿主没有提供 llm 服务，列不出模型；请手动填 provider 和 model',
        })
      }
      const { providers, error } = await discover(llm)
      const config = await readConfig()
      return sendJson(res, 200, {
        ok: error === undefined,
        providers,
        // 方便面板标出"当前选的是哪个"，以及当前选择是否真的能看图
        current: { provider: config.judgeProvider, model: config.judgeModel },
        visionCount: providers.reduce((sum, p) => sum + p.models.filter((m) => m.vision).length, 0),
        ...(error === undefined ? {} : { error }),
      })
    },
  })
}
