import { readdir, lstat, realpath, readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { HOME_DIR } from './config.js'

export const VALID_NAME = /^[a-f0-9]{40}\.(png|jpe?g|gif|webp)$/
export async function libraryFile(library, filename) {
  if (!VALID_NAME.test(filename)) throw new Error('文件名无效，请先查询图库')
  const path = join(library, filename)
  const info = await lstat(path)
  if (!info.isFile() || dirname(await realpath(path)) !== await realpath(resolve(library))) throw new Error('文件不属于图库或不是普通文件')
  return { path, bytes: info.size }
}
export async function listFiles(library) {
  const names = await readdir(library).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const rows = []
  for (const filename of names.sort()) {
    if (!VALID_NAME.test(filename)) continue
    try { rows.push({ filename, ...(await libraryFile(library, filename)), ext: filename.split('.').pop() }) } catch { /* removed or unsafe */ }
  }
  return rows
}
export function storePath(library, kind) {
  const key = createHash('sha256').update(resolve(library).toLowerCase()).digest('hex').slice(0, 24)
  return join(HOME_DIR, `${kind}-${key}.json`)
}
export async function readStore(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return {}; throw error }
}
export async function writeStore(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n')
  await rename(temp, path)
}
export function normalizeMetadata(value) {
  if (!value || typeof value !== 'object') throw new Error('图片描述必须是对象')
  const out = {}
  for (const key of ['text', 'description']) {
    if (typeof value[key] !== 'string' || value[key].length > 2000) throw new Error(`${key} 必须是最多 2000 字符的文字`)
    out[key] = value[key].trim()
  }
  if (!out.description) throw new Error('画面描述不能为空')
  for (const key of ['emotions', 'scenes', 'avoid']) {
    if (!Array.isArray(value[key]) || value[key].length > 30 || value[key].some(x => typeof x !== 'string' || x.length > 200)) throw new Error(`${key} 必须是短文字数组`)
    out[key] = value[key].map(x => x.trim()).filter(Boolean)
  }
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error('confidence 需要在 0–1 之间')
  out.confidence = value.confidence
  return out
}
export function rankStickers(rows, query) {
  const q = String(query).normalize('NFKC').toLowerCase().trim()
  if (!q || q.length > 500) throw new Error('检索内容需要在 1–500 字符之间')
  const segments = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(q)].filter(x => x.isWordLike).map(x => x.segment)
  const terms = [...new Set([...segments, ...(q.match(/[\p{Script=Han}]{2,}/gu) || []).flatMap(s => Array.from({length:s.length-1}, (_,i)=>s.slice(i,i+2)))])]
  return rows.map(item => {
    let score = 0
    for (const [key, weight] of [['text', 5], ['emotions', 4], ['scenes', 3], ['description', 1]]) {
      const text = (Array.isArray(item[key]) ? item[key].join(' ') : item[key] || '').toLowerCase()
      for (const term of terms) if (text.includes(term)) score += weight * Math.min(term.length, 6)
    }
    return { ...item, score }
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score || a.filename.localeCompare(b.filename))
}
