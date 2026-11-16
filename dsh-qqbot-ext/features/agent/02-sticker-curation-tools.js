// curated 模式（模型自己判断喜欢程度）下，让模型看暂存表情并决定收不收。
//
// 三个工具一对半：
//   qq_sticker_pending —— 列出还没判断的表情（含本地绝对路径，喂给 qqbot_describe_image）
//   qq_sticker_keep    —— 判断"喜欢"后收进图库
//   qq_sticker_drop    —— 判断"不喜欢"后丢掉
//
// 只有 collectMode=curated 时才有意义；auto 模式下暂存区是空的，工具会直接说清楚。
const NAME = /^[a-f0-9]{40}\.(png|jpe?g|gif|webp)$/i

function collector(ctx) {
  try {
    return ctx.get('qqbotExtStickerCollector')
  } catch {
    return undefined
  }
}

export function register(ctx) {
  ctx.tools.register({
    name: 'qq_sticker_pending',
    description:
      '列出暂存区里还没判断过的 QQ 表情包。每项带本地绝对路径，可以把它交给 qqbot_describe_image 看清楚是什么内容，再决定用 qq_sticker_keep 收进图库还是 qq_sticker_drop 丢掉。仅当收集模式是「模型判断」时才会有内容。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '最多返回几项，默认 10，最大 30' } },
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          pending: { type: 'array', items: { type: 'object', additionalProperties: true } },
          total: { type: 'integer' },
          mode: { type: 'string' },
        },
        required: ['pending', 'total', 'mode'],
      },
      render: (_args, value) => [{ type: 'text', text: value?.mode !== 'curated'
        ? `当前是自动全收模式，没有待判断的表情。想改成由你判断，去设置页把收集模式换成「模型判断」。`
        : value.pending.length === 0
          ? '暂存区是空的，没有等你判断的表情。'
          : `待判断 ${value.total} 张：\n` + value.pending.map((item) => `${item.filename}（${item.ext}, ${item.bytes} 字节, 原名「${item.stickerName || '未知表情'}」）\n  路径：${item.path}`).join('\n') }],
    },
    async execute(args) {
      const service = collector(ctx)
      if (typeof service?.listPending !== 'function') return { pending: [], total: 0, mode: 'unavailable' }
      const rows = await service.listPending()
      const rawLimit = Number(args?.limit)
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(30, Math.trunc(rawLimit))) : 10
      const mode = String(service.status?.mode ?? 'auto')
      return { pending: rows.slice(0, limit), total: rows.length, mode }
    },
  })

  ctx.tools.register({
    name: 'qq_sticker_keep',
    description:
      '把暂存区里的一张表情收进图库。先用 qq_sticker_pending 拿到文件名，看过图再决定。',
    parameters: {
      type: 'object',
      properties: { filename: { type: 'string', description: 'qq_sticker_pending 返回的完整文件名' } },
      required: ['filename'],
      additionalProperties: false,
    },
    isConcurrencySafe: () => false,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { filename: { type: 'string' }, duplicate: { type: 'boolean' } },
        required: ['filename', 'duplicate'],
      },
      render: (_args, value) => [{ type: 'text', text: value?.duplicate
        ? `${value.filename} 图库里已经有了，暂存的那份已清掉`
        : `已收进图库：${value?.filename ?? ''}` }],
    },
    async execute(args) {
      const filename = String(args?.filename ?? '')
      if (!NAME.test(filename)) throw new Error('文件名无效，请先用 qq_sticker_pending 查询')
      const service = collector(ctx)
      if (typeof service?.approve !== 'function') throw new Error('表情收集服务不可用')
      const result = await service.approve(filename)
      return { filename, duplicate: result?.duplicate === true }
    },
  })

  ctx.tools.register({
    name: 'qq_sticker_drop',
    description: '丢掉暂存区里的一张表情，不收进图库。',
    parameters: {
      type: 'object',
      properties: { filename: { type: 'string', description: 'qq_sticker_pending 返回的完整文件名' } },
      required: ['filename'],
      additionalProperties: false,
    },
    isConcurrencySafe: () => false,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { filename: { type: 'string' } },
        required: ['filename'],
      },
      render: (_args, value) => [{ type: 'text', text: `已丢掉：${value?.filename ?? ''}` }],
    },
    async execute(args) {
      const filename = String(args?.filename ?? '')
      if (!NAME.test(filename)) throw new Error('文件名无效，请先用 qq_sticker_pending 查询')
      const service = collector(ctx)
      if (typeof service?.reject !== 'function') throw new Error('表情收集服务不可用')
      await service.reject(filename)
      return { filename }
    },
  })
}
