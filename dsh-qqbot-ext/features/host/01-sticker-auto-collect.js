// 收集正文带 QQ 表情标记的唯一图片附件，普通图片不会进入图库。
// 图库路径与过滤阈值来自 lib/config.js（Web 配置页可改，即时生效）。
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { libraryDirOf, pendingDirOf, readConfig } from '../../lib/config.js'

const HASH_PREFIX_LENGTH = 40
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const CONFIG_TTL_MS = 2000
const DOWNLOAD_TIMEOUT_MS = 20000

function imageFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg'
  if (bytes.length >= 8 && bytes.toString('latin1', 1, 4) === 'PNG') return '.png'
  if (bytes.length >= 6 && bytes.toString('latin1', 0, 3) === 'GIF') return '.gif'
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return '.webp'
  return undefined
}

function imageDimensions(bytes, format) {
  if (format === '.png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (format === '.gif' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (format === '.webp' && bytes.length >= 30) {
    const kind = bytes.toString('latin1', 12, 16)
    if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
    if (kind === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L') {
      const bits = bytes.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
  }
  if (format === '.jpg') {
    let pos = 2
    while (pos + 3 < bytes.length) {
      if (bytes[pos] !== 0xff) return undefined
      let cursor = pos + 1
      while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1
      if (cursor >= bytes.length) return undefined
      const marker = bytes[cursor]
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) return undefined
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (cursor + 8 > bytes.length) return undefined
        return { height: bytes.readUInt16BE(cursor + 4), width: bytes.readUInt16BE(cursor + 6) }
      }
      if (cursor + 3 > bytes.length) return undefined
      const length = bytes.readUInt16BE(cursor + 1)
      if (length < 2) return undefined
      pos = cursor + 1 + length
    }
  }
  return undefined
}

export function register(ctx) {
  const logger = ctx.logger ?? console
  const stats = { collected: 0, skipped: 0, duplicates: 0, pending: 0, approved: 0, rejected: 0, dropped: 0 }
  let cachedAt = 0
  let cachedConfig
  let known
  let knownDir
  let queue = Promise.resolve()
  // curated 模式下暂存区里还没被模型判断的表情：filename -> { stickerName, at }
  let pendingMeta = new Map()

  // 配置页改动后最多 2 秒生效，避免每条入站消息都读盘。
  const config = async () => {
    if (cachedConfig !== undefined && Date.now() - cachedAt < CONFIG_TTL_MS) return cachedConfig
    cachedConfig = await readConfig()
    cachedAt = Date.now()
    return cachedConfig
  }

  /** 从 QQ CDN 抓图（钩子移到 concurrencyGuard 之前后，附件还没落盘）。 */
  const download = async (url, maxBytes) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const declared = Number(res.headers.get('content-length') ?? '')
      if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`内容过大：${declared} 字节`)
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length > maxBytes) throw new Error(`内容过大：${buffer.length} 字节`)
      return buffer
    } finally {
      clearTimeout(timer)
    }
  }

  const collectOne = async (payload) => {
    const options = await config()
    if (!options.enabled) return
    if (payload?.stickerTag !== true || !/^image\//i.test(String(payload?.contentType ?? ''))) {
      stats.skipped += 1
      return
    }
    const library = libraryDirOf(options)
    try {
      // 新接缝给 url；旧接缝（链尾版）给 localPath，两种都认。
      let bytes
      if (typeof payload.url === 'string' && payload.url !== '') {
        bytes = await download(payload.url, options.maxBytes)
      } else if (typeof payload.localPath === 'string') {
        const metadata = await stat(payload.localPath)
        if (!metadata.isFile()) {
          stats.skipped += 1
          return
        }
        bytes = await readFile(payload.localPath)
      } else {
        stats.skipped += 1
        return
      }
      if (bytes.length < options.minBytes || bytes.length > options.maxBytes) {
        stats.skipped += 1
        return
      }
      const format = imageFormat(bytes)
      const dimensions = format && imageDimensions(bytes, format)
      if (!dimensions || Math.max(dimensions.width, dimensions.height) < options.minEdge
        || Math.max(dimensions.width, dimensions.height) > options.maxEdge
        || Math.min(dimensions.width, dimensions.height) <= 0
        || Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height) > options.maxAspect) {
        stats.skipped += 1
        return
      }

      await mkdir(library, { recursive: true })
      if (!known || knownDir !== library) {
        const names = await readdir(library).catch(() => [])
        known = new Set(names.filter((name) => IMAGE_EXTS.has(extname(name).toLowerCase())))
        knownDir = library
      }
      if (known.size >= options.maxLibrary) {
        stats.skipped += 1
        return
      }
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, HASH_PREFIX_LENGTH)
      const filename = `${hash}${format}`

      // curated 模式：先落暂存区，等模型自己看过图再决定要不要进图库。
      // 暂存区不放图库里，避免 qq_list_stickers 把没判断过的也列成正式表情。
      if (options.collectMode === 'curated') {
        const pending = pendingDirOf(options)
        await mkdir(pending, { recursive: true })
        const pendingPath = join(pending, filename)
        if (existsSync(pendingPath) || pendingMeta.has(filename)) {
          stats.duplicates += 1
          return
        }
        await writeFile(pendingPath, bytes)
        pendingMeta.set(filename, { stickerName: String(payload.stickerName ?? '未知表情'), at: Date.now() })
        await trimPending(options.pendingLimit)
        stats.pending += 1
        logger.info?.(`[dsh-qqbot-ext] 表情包已暂存待判断：${payload.stickerName || '未知表情'} → ${filename} (${dimensions.width}×${dimensions.height})`)
        // 通知后台判断器有新料（它自己会看配置决定要不要真跑）
        try { ctx.emit?.('qqbot-ext/sticker-pending', { filename }) } catch { /* 事件无人监听也无所谓 */ }
        return
      }

      if (known.has(filename) || existsSync(join(library, filename))) {
        known.add(filename)
        stats.duplicates += 1
        return
      }
      await writeFile(join(library, filename), bytes)
      known.add(filename)
      stats.collected += 1
      try { ctx.emit?.('qqbot-ext/sticker-collected', { filename }) } catch { /* optional listener */ }
      logger.info?.(`[dsh-qqbot-ext] 表情包已收集：${payload.stickerName || '未知表情'} → ${filename} (${dimensions.width}×${dimensions.height})`)
    } catch (error) {
      stats.skipped += 1
      logger.warn?.(`[dsh-qqbot-ext] 表情包收集失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 暂存区超过上限时丢最旧的，避免没人处理时无限涨。 */
  const trimPending = async (limit) => {
    if (limit <= 0) {
      for (const filename of [...pendingMeta.keys()]) {
        const options = await config()
        await rm(join(pendingDirOf(options), filename), { force: true }).catch(() => {})
        pendingMeta.delete(filename)
      }
      return
    }
    const overflow = pendingMeta.size - limit
    if (overflow <= 0) return
    const oldest = [...pendingMeta.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, overflow)
    const options = await config()
    const pending = pendingDirOf(options)
    for (const [filename] of oldest) {
      await rm(join(pending, filename), { force: true }).catch(() => {})
      pendingMeta.delete(filename)
      stats.dropped += 1
    }
  }

  /** 把暂存区的某张移进正式图库。 */
  const approveOne = async (filename) => {
    const options = await config()
    const pending = pendingDirOf(options)
    const library = libraryDirOf(options)
    const source = join(pending, filename)
    if (!existsSync(source)) throw new Error(`暂存区没有这个文件：${filename}`)
    await mkdir(library, { recursive: true })
    if (!known || knownDir !== library) {
      const names = await readdir(library).catch(() => [])
      known = new Set(names.filter((name) => IMAGE_EXTS.has(extname(name).toLowerCase())))
      knownDir = library
    }
    if (known.size >= options.maxLibrary) throw new Error(`图库已满（${options.maxLibrary} 张），先删一些再收`)
    if (known.has(filename) || existsSync(join(library, filename))) {
      await rm(source, { force: true })
      pendingMeta.delete(filename)
      stats.duplicates += 1
      return { filename, duplicate: true }
    }
    await writeFile(join(library, filename), await readFile(source))
    await rm(source, { force: true })
    pendingMeta.delete(filename)
    known.add(filename)
    stats.collected += 1
    stats.approved += 1
    try { ctx.emit?.('qqbot-ext/sticker-collected', { filename }) } catch { /* optional listener */ }
    return { filename, duplicate: false }
  }

  /** 丢掉暂存区的某张。 */
  const rejectOne = async (filename) => {
    const options = await config()
    const source = join(pendingDirOf(options), filename)
    if (!existsSync(source)) throw new Error(`暂存区没有这个文件：${filename}`)
    await rm(source, { force: true })
    pendingMeta.delete(filename)
    stats.rejected += 1
    return { filename }
  }

  /** 列出暂存区（按入队时间从旧到新）。 */
  const listPending = async () => {
    const options = await config()
    const pending = pendingDirOf(options)
    const names = await readdir(pending).catch(() => [])
    const rows = []
    for (const filename of names) {
      if (!IMAGE_EXTS.has(extname(filename).toLowerCase())) continue
      const info = await stat(join(pending, filename)).catch(() => undefined)
      if (info === undefined || !info.isFile()) continue
      rows.push({
        filename,
        bytes: info.size,
        ext: extname(filename).slice(1),
        path: join(pending, filename),
        stickerName: pendingMeta.get(filename)?.stickerName ?? '',
      })
    }
    return rows.sort((a, b) => (pendingMeta.get(a.filename)?.at ?? 0) - (pendingMeta.get(b.filename)?.at ?? 0))
  }

  ctx.on('qqbot/sticker-candidate', (payload) => {
    queue = queue.then(() => collectOne(payload)).catch((error) => {
      logger.warn?.(`[dsh-qqbot-ext] 表情收集队列失败：${error instanceof Error ? error.message : String(error)}`)
    })
  })

  ctx.effect(() => () => {
    cachedConfig = undefined
    known = undefined
    knownDir = undefined
  }, 'dsh-qqbot-ext.sticker-collector')

  try {
    ctx.provide('qqbotExtStickerCollector', {
      get status() {
        const running = cachedConfig ?? { enabled: true }
        return {
          enabled: running.enabled,
          mode: running.collectMode ?? 'auto',
          library: cachedConfig === undefined ? undefined : libraryDirOf(cachedConfig),
          pendingCount: pendingMeta.size,
          ...stats,
        }
      },
      /** curated 模式：暂存区里等待模型判断的表情。 */
      listPending,
      /** curated 模式：模型判断"喜欢"后调用，把暂存的表情移进图库。 */
      approve: approveOne,
      /** curated 模式：模型判断"不喜欢"后调用，丢掉暂存的这张。 */
      reject: rejectOne,
      /** 配置页保存后让下次收集立刻读到新值。 */
      invalidate() {
        cachedConfig = undefined
        known = undefined
        knownDir = undefined
      },
    })
  } catch {
    // Duplicate provider during a development reload: keep the collector listener.
  }
}
