import { readConfig } from '../../lib/config.js'
import { createIndexer } from './_sticker-index.js'
export function register(ctx) {
  const indexer = createIndexer({ctx, getConfig:readConfig, logger:ctx.logger})
  ctx.provide('qqbotExtStickerIndex', indexer)
  ctx.on('qqbot-ext/sticker-collected', indexer.schedule)
  ctx.on('qqbot-ext/config-updated', indexer.schedule)
  ctx.effect(() => {indexer.schedule(); return () => indexer.stop()}, 'dsh-qqbot-ext.sticker-index')
}
