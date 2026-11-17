import { createHash } from 'node:crypto'
import { storePath, readStore, writeStore, libraryFile } from './sticker-store.js'
export function cooldownOf(record, filename, config, now = Date.now()) {
  const same = record?.files?.[filename], last = record?.last
  const sameRemaining = same === undefined ? 0 : Math.max(0, config.sameStickerCooldownSeconds * 1000 - (now - same))
  const intervalRemaining = last === undefined ? 0 : Math.max(0, config.stickerSendIntervalSeconds * 1000 - (now - last))
  return { cooldownSeconds: Math.ceil(Math.max(sameRemaining, intervalRemaining) / 1000), sameRemainingSeconds:Math.ceil(sameRemaining/1000), intervalRemainingSeconds:Math.ceil(intervalRemaining/1000) }
}
export function createSendGuard({load = readStore, save = writeStore, now = Date.now} = {}) {
  let queue = Promise.resolve()
  const keyOf = key => createHash('sha256').update(key).digest('hex')
  return {
    async availability(library, key, filename, config) {
      const records = await load(storePath(library,'usage'))
      return cooldownOf(records[keyOf(key)], filename, config, now())
    },
    send({library, key, filename, getConfig, deliver}) {
      const task = queue.then(async () => {
        await libraryFile(library,filename)
        const config = await getConfig()
        const path = storePath(library,'usage'), records = await load(path), hash = keyOf(key)
        const remaining = cooldownOf(records[hash], filename, config, now())
        if (remaining.cooldownSeconds) throw new Error(`表情冷却中，还需 ${remaining.cooldownSeconds} 秒`)
        const result = await deliver()
        if (!result?.message?.id) throw new Error('QQ 发送未返回消息 ID，无法确认发送成功')
        const record = records[hash] || {files:{}}
        record.files ||= {}
        record.last = now(); record.files[filename] = record.last
        records[hash] = record
        try { await save(path,records) } catch (error) { throw new Error(`表情已发送（消息 ID ${result.message.id}），但冷却记录保存失败：${error.message}`) }
        return result
      })
      queue = task.catch(()=>{})
      return task
    },
  }
}
