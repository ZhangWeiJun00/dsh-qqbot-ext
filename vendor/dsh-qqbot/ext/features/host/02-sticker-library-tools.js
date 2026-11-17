// Personal QQ sticker library browse and send tools.
// 图库目录由 lib/config.js 决定（Web 配置页可改）。
import { libraryDirOf, readConfig } from '../../lib/config.js'
import { listFiles as readLibrary, readStore, storePath, rankStickers } from '../../lib/sticker-store.js'
import { createSendGuard } from '../../lib/sticker-cooldown.js'

const VALID_NAME = /^[a-f0-9]{40}\.(png|jpe?g|gif|webp)$/i

const listFiles = readLibrary

export function register(ctx) {
  const guard = createSendGuard()
  const senderOf = () => { try { return ctx.get('qqbotExtStickerSender') } catch { return undefined } }
  ctx.tools.register({
    name: 'qq_search_stickers',
    description: '按情绪、图中文字或场景搜索表情。接梗或表达情绪时可主动搜索；根据上下文和人设决定是否发送，没有合适的不要硬发，不用文件名猜图意。',
    parameters: { type:'object', properties:{query:{type:'string',description:'情绪、关键词和场景，例如：炸毛 不服 被调侃后玩笑回怼'},limit:{type:'integer'}},required:['query'],additionalProperties:false },
    isConcurrencySafe:()=>true,
    output: {schema:{type:'object',additionalProperties:false,properties:{stickers:{type:'array',items:{type:'object',additionalProperties:true}},unindexed:{type:'integer'},note:{type:'string'}},required:['stickers','unindexed','note']},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args,exec) {
      const config=await readConfig(), library=libraryDirOf(config)
      const rows=await listFiles(library), data=await readStore(storePath(library,'index'))
      const candidates=rows.filter(row=>data[row.filename]).map(row=>({filename:row.filename,...data[row.filename]}))
      const ranked=rankStickers(candidates,args.query)
      const sender=senderOf()
      let key
      try { key=sender?.conversationKey?.(exec?.agent) } catch { /* outside QQ */ }
      const limit=Number.isFinite(Number(args.limit)) ? Math.max(1,Math.min(10,Math.trunc(Number(args.limit)))) : 5
      const results=[]
      for (const item of ranked) results.push({...item,...(key ? await guard.availability(library,key,item.filename,config) : {cooldownSeconds:null})})
      results.sort((a,b)=>(a.cooldownSeconds > 0)-(b.cooldownSeconds > 0) || b.score-a.score)
      return {stickers:results.slice(0,limit),unindexed:rows.length-candidates.length,note:key ? '根据图意、avoid 和上下文挑选；冷却中的不要发；无匹配就用文字或不回应。' : '当前无法确定 QQ 会话，冷却未知；索引为空时先到配置页启用图片理解。'}
    },
  })
  ctx.tools.register({
    name: 'qq_list_stickers',
    description: '列出自动收集进个人图库的 QQ 表情包图片。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '最多返回项数，默认 30，最大 100' } },
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          stickers: { type: 'array', items: { type: 'object', additionalProperties: true } },
          total: { type: 'integer' }, truncated: { type: 'boolean' }, libraryDir: { type: 'string' },
        },
        required: ['stickers', 'total', 'truncated'],
      },
      render: (_args, value) => [{ type: 'text', text: value?.stickers?.length
        ? `图库：${value.libraryDir}\n` + value.stickers.map((item) => `${item.filename} (${item.ext}, ${item.bytes} bytes)`).join('\n') + (value.truncated ? `\n…另有 ${value.total - value.stickers.length} 张` : '')
        : `图库还是空的（${value?.libraryDir ?? ''}）` }],
    },
    async execute(args) {
      const library = libraryDirOf(await readConfig())
      const rows = await listFiles(library)
      const rawLimit = Number(args?.limit)
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.trunc(rawLimit))) : 30
      return { stickers: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit, libraryDir: library }
    },
  })

  ctx.tools.register({
    name: 'qq_sticker_status',
    description: '查看 QQ 表情包自动收集开关、收集模式、图库位置和累计统计。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' }, mode: { type: 'string' }, total: { type: 'integer' },
          collected: { type: 'integer' }, skipped: { type: 'integer' }, duplicates: { type: 'integer' },
          pendingCount: { type: 'integer' },
          libraryDir: { type: 'string' }, maxLibrary: { type: 'integer' },
        },
        required: ['enabled', 'mode', 'total', 'collected', 'skipped', 'duplicates'],
      },
      render: (_args, value) => [{ type: 'text', text: value?.enabled
        ? `自动收集开启（${value.mode === 'curated' ? '模型判断' : '全收'}）｜图库 ${value.total}/${value.maxLibrary} 张｜位置 ${value.libraryDir}｜本次收集 ${value.collected}｜暂存待判断 ${value.pendingCount ?? 0}｜过滤 ${value.skipped}｜重复 ${value.duplicates}`
        : `自动收集关闭｜图库路径 ${value?.libraryDir ?? ''}` }],
    },
    async execute() {
      const config = await readConfig()
      const library = libraryDirOf(config)
      const stickers = await listFiles(library)
      let status
      try { status = ctx.get('qqbotExtStickerCollector')?.status } catch { status = undefined }
      return {
        enabled: config.enabled,
        mode: config.collectMode,
        total: stickers.length,
        collected: Number(status?.collected ?? 0),
        skipped: Number(status?.skipped ?? 0),
        duplicates: Number(status?.duplicates ?? 0),
        pendingCount: Number(status?.pendingCount ?? 0),
        libraryDir: library,
        maxLibrary: config.maxLibrary,
      }
    },
  })

  ctx.tools.register({
    name: 'qq_send_sticker',
    description: '将自动收集到个人图库中的 QQ 表情包发送到当前会话。先用 qq_search_stickers 按语境选图；必须理解图意并适合当前聊天。受可配置的同图冷却和连续发送间隔限制。',
    parameters: {
      type: 'object',
      properties: { filename: { type: 'string', description: 'qq_list_stickers 返回的完整文件名' } },
      required: ['filename'],
      additionalProperties: false,
    },
    isConcurrencySafe: () => false,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { filename: { type: 'string' }, messageId: { type: 'string' } },
        required: ['filename'],
      },
      render: (_args, value) => [{ type: 'text', text: `已发送表情包 ${value?.filename ?? ''}` }],
    },
    async execute(args, exec) {
      const filename = String(args?.filename ?? '')
      if (!VALID_NAME.test(filename)) throw new Error('文件名无效，请先使用 qq_list_stickers 查询')
      let sender
      try { sender = ctx.get('qqbotExtStickerSender') } catch { sender = undefined }
      if (typeof sender?.send !== 'function') throw new Error('官方 QQ 图片发送服务不可用')
      if (typeof sender.conversationKey !== 'function') throw new Error('发送接缝需要更新并重启 DSH，暂时无法校验会话冷却')
      const key = sender.conversationKey(exec?.agent)
      if (typeof key !== 'string' || !key) throw new Error('无法确定当前 QQ 会话')
      const library = libraryDirOf(await readConfig())
      const result = await guard.send({library, key, filename, getConfig:async () => {
        const live=await readConfig()
        if (libraryDirOf(live)!==library) throw new Error('图库位置已变更，请重新搜索')
        return live
      }, deliver:()=>sender.send(exec?.agent,filename)})
      return { filename, ...(result?.message?.id ? { messageId: String(result.message.id) } : {}) }
    },
  })
}
