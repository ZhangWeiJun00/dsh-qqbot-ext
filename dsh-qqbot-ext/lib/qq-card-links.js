// Extract video targets from the original official QQ event, before history/merge.
// No network, no raw-event logging or persistence. Fields are external evidence.
export function extractBilibiliCardLinks(raw) {
  const links = new Set(), seen = new WeakSet()
  let nodes = 0, chars = 0
  function visit(value, depth = 0, key = '') {
    if (depth > 12 || ++nodes > 2500 || chars > 250000) return
    if (typeof value === 'string') {
      if (/^(?:preview|source_logo|icon|cover|pic|image|thumbnail)$/i.test(key)) return
      if (value.length > 100000) return
      chars += value.length
      const text = value.replace(/\\\//g, '/').replace(/&amp;/g, '&')
      for (const match of text.matchAll(/https?:\/\/[^\s<>"'\\）)】\]，。]+/gi)) {
        try {
          const u = new URL(match[0])
          if (u.username || u.password || u.port) continue
          const host = u.hostname.toLowerCase()
          if (['b23.tv', 'bili2233.cn'].includes(host) || (['www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(host) && /^\/video\/(?:BV[0-9a-z]{10}|av\d+)(?:\/|$)/i.test(u.pathname))) {
            u.protocol = 'https:'; links.add(u.href)
          }
        } catch { /* ignore non-URLs */ }
      }
      // Miniapp path often stores a percent-encoded target URL or BV id.
      if (/%[0-9a-f]{2}/i.test(text)) {
        try { const decoded = decodeURIComponent(text); if (decoded !== text) visit(decoded, depth + 1, key) } catch { /* malformed escape */ }
      }
      if (/^(?:qqdocurl|url|jump_url|jumpUrl|pagepath|page_path|path|target_url|content)$/i.test(key)) {
        const id = text.match(/\b(BV[0-9A-Za-z]{10})\b/)?.[1]
        if (id && !/https?:\/\//i.test(text)) links.add(`https://www.bilibili.com/video/${id}`)
      }
      if (/^[\s]*[\[{]/.test(text)) {
        try { visit(JSON.parse(text), depth + 1, key) } catch { /* not JSON */ }
      }
      return
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    for (const [childKey, child] of Object.entries(value)) {
      if (/^(?:author|mentions|attachments|referenced_message|message_reference)$/i.test(childKey)) continue
      // msg_elements in quote events describes the quoted message, not current card.
      if (childKey === 'msg_elements' && value.message_type === 103) continue
      visit(child, depth + 1, childKey)
      if (links.size >= 8 || nodes > 2500 || chars > 250000) break
    }
  }
  visit(raw)
  return [...links].slice(0, 8)
}

export function preserveBilibiliCardLinks(message) {
  const links = extractBilibiliCardLinks(message.raw)
  const content = String(message.content ?? '')
  const missing = links.filter(url => !content.includes(url))
  if (missing.length) message.content = `${content}\n[B站原始卡片链接]\n${missing.join('\n')}`.trim()
  return links
}
