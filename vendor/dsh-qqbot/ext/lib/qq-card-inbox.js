import { extractBilibiliCardLinks } from './qq-card-links.js'

// Keep message references only. raw is accessed exclusively inside read().
export function createCardInbox({ now = Date.now } = {}) {
  const peers = new Map()
  function prune() {
    for (const [key, rows] of peers) {
      const live = rows.filter(row => now() - row.at < 600000)
      if (live.length) peers.set(key, live)
      else peers.delete(key)
    }
  }
  return {
    capture(key, message) {
      if (!key || !message || !/卡片|小程序|哔哩哔哩|bilibili/i.test(String(message.content ?? ''))) return
      prune()
      const rows = peers.get(key) ?? []
      const id = String(message.messageId ?? '')
      const next = rows.filter(row => row.id !== id)
      next.push({ id, message, at: now() })
      peers.delete(key)
      peers.set(key, next.slice(-20))
      if (peers.size > 100) peers.delete(peers.keys().next().value)
    },
    read(key, messageId) {
      prune()
      const rows = peers.get(key) ?? []
      const row = messageId ? rows.find(r => r.id === messageId) : rows.at(-1)
      if (!row) return { status: 'unavailable', links: [], note: '当前QQ会话没有可用的近期卡片，或已超过10分钟。请重新发送卡片。' }
      const links = extractBilibiliCardLinks(row.message.raw)
      return { status: links.length ? 'found' : 'missing_link', message_id: row.id, links, note: links.length ? '已按需读取原始卡片，仅返回视频链接。' : '已按需检查此卡片原始数据，未提取到支持的B站链接。' }
    },
  }
}
