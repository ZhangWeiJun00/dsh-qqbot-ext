// Personal QQ sticker library browse and send tools.
// 图库目录由 lib/config.js 决定（Web 配置页可改）。
import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { libraryDirOf, readConfig } from '../../lib/config.js'

const VALID_NAME = /^[a-f0-9]{40}\.(png|jpe?g|gif|webp)$/i

async function listFiles(library) {
  const names = await readdir(library).catch(() => [])
  const rows = []
  for (const filename of names) {
    if (!VALID_NAME.test(filename)) continue
    try {
      const info = await stat(join(library, filename))
      if (info.isFile()) rows.push({ filename, bytes: info.size, ext: extname(filename).slice(1) })
    } catch {
      // File might be removed during listing.
    }
  }
  return rows.sort((a, b) => a.filename.localeCompare(b.filename))
}

export function register(ctx) {
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
    description: '将自动收集到个人图库中的 QQ 表情包发送到当前会话。先用 qq_list_stickers 查看文件名。',
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
      const result = await sender.send(exec?.agent, filename)
      return { filename, ...(result?.message?.id ? { messageId: String(result.message.id) } : {}) }
    },
  })
}
