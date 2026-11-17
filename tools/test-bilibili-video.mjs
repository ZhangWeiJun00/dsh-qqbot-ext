import assert from 'node:assert/strict'
import { createBilibiliReader, parseVideoInput } from '../dsh-qqbot-ext/lib/bilibili.js'
import { register } from '../dsh-qqbot-ext/features/host/06-bilibili-video.js'

const bvid = 'BV1xx411c7mD'
const title = '内存反垄断诉讼迎来重大进展：法院拒绝撤案｜显卡日报11月17日'
const card = `[繁似尘 (49161E141D763BA15DB7EDE53BFD96D6)] [卡片消息] 小程序\n摘要: [QQ小程序]${title}\nsource: 哔哩哔哩\nsource_logo: http://miniapp.gtimg.cn/public/appicon/icon.jpg\ntitle: ${title}\npreview: https://qq.ugcimg.cn/v1/cover`
let passed = 0
async function test(name, fn) { await fn(); console.log(`PASS ${++passed} ${name}`) }
const ok = data => Response.json({ code: 0, data })
let calls = [], mode = '', clock = 0
const fetchImpl = async (url, options) => {
  calls.push(url)
  assert.equal(options.redirect, 'manual')
  const u = new URL(url)
  if (u.hostname === 'b23.tv') return new Response('', { status: 302, headers: { location: mode === 'redirect' ? 'http://127.0.0.1/private' : `https://www.bilibili.com/video/${bvid}?p=2` } })
  if (u.hostname === 'www.bilibili.com') return new Response('video')
  if (u.pathname.includes('/search/type')) return ok({ result: [{ bvid, title: `<em>${title}</em>`, author: '甲' }, { bvid: 'BV1yy411c7mD', title, author: '乙' }] })
  if (u.pathname.endsWith('/view')) return ok({ aid: 42, bvid, title, owner: { name: 'UP' }, desc: '介绍', stat: { view: 10, like: 2 }, pages: [{ page: 1, cid: 101, duration: 30, part: '一' }, { page: 2, cid: 102, duration: 40, part: '二' }] })
  if (u.pathname.endsWith('/v2')) {
    if (mode === 'restricted') return Response.json({ code: -101, message: '需要登录' })
    return ok({ subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: mode === 'badsubtitle' ? 'https://127.0.0.1/private' : 'https://aisubtitle.hdslb.com/a.json' }] } })
  }
  if (u.hostname === 'aisubtitle.hdslb.com') return Response.json({ body: [{ from: 0, content: '字幕内容'.repeat(30) }] })
  if (u.pathname.endsWith('/reply')) return ok({ replies: [{ content: { message: '评论' }, like: 2 }] })
  if (u.hostname === 'comment.bilibili.com') return new Response('<i><d p="1.2,1,1">弹幕&amp;内容</d></i>')
  throw new Error(`unexpected URL ${url}`)
}
await test('provided title/preview-only card extracts title, not image URL', () => assert.deepEqual(parseVideoInput(card), { title }))
await test('video URL wins over cover and preserves p', () => assert.equal(parseVideoInput(`https://qq.ugcimg.cn/cover https://www.bilibili.com/video/${bvid}?p=2`).page, 2))
await test('BV and av identifiers', () => { assert.equal(parseVideoInput(bvid).id, bvid); assert.equal(parseVideoInput('av123').id, 'av123') })
await test('cover-only fails without fetching cover', () => assert.throws(() => parseVideoInput('preview: https://qq.ugcimg.cn/cover'), /封面/))
await test('title-only card returns missing_link without any request', async () => {
  calls = []
  const r = await createBilibiliReader({ fetchImpl }).read(card)
  assert.equal(r.status, 'missing_link'); assert.equal(r.title, title)
  assert.equal(calls.length, 0)
  assert.equal(r.candidates, undefined)
})
await test('provided video identifier reads public evidence and caches results', async () => {
  const reader = createBilibiliReader({ fetchImpl, now: () => clock })
  const r = await reader.read(bvid, { max_chars: 20 })
  assert.equal(r.status, 'read'); assert.equal(r.matchedByTitle, false)
  assert.equal(r.transcript.length, 20); assert.equal(r.transcriptTruncated, true)
  assert.equal(r.comments[0].text, '评论'); assert.equal(r.danmaku[0].text, '弹幕&内容')
  assert.match(r.evidenceNote, /未观看画面/)
  const count = calls.length
  assert.equal((await reader.read(bvid, { max_chars: 20 })).cached, true)
  assert.equal(calls.length, count)
  clock = 300001
  assert.equal((await reader.read(bvid, { max_chars: 20 })).cached, false)
})
await test('explicit search returns candidates without reading a video', async () => {
  calls = []
  const r = await createBilibiliReader({ fetchImpl }).search(title)
  assert.equal(r.status, 'candidates'); assert.equal(r.query, title)
  assert.equal(r.candidates.length, 2)
  assert.equal(r.candidates[0].title, title)
  assert.equal(r.candidates[0].url, `https://www.bilibili.com/video/${bvid}`)
  assert.equal(calls.length, 1)
  assert.equal(new URL(calls[0]).pathname, '/x/web-interface/search/type')
})
await test('short link preserves final page', async () => {
  const r = await createBilibiliReader({ fetchImpl }).read('https://b23.tv/abc')
  assert.equal(r.page, 2)
})
await test('page override and invalid page', async () => {
  const reader = createBilibiliReader({ fetchImpl })
  assert.equal((await reader.read(`https://www.bilibili.com/video/${bvid}?p=2`, { page: 1 })).page, 1)
  await assert.rejects(reader.read(bvid, { page: 3 }), /没有第3P/)
})
await test('login-restricted subtitle keeps metadata and explicit warning', async () => {
  mode = 'restricted'
  const r = await createBilibiliReader({ fetchImpl }).read(bvid)
  assert.equal(r.transcriptStatus, 'unavailable'); assert.match(r.warnings.join(), /需要登录/); assert.equal(r.title, title); mode = ''
})
await test('redirect to private host is rejected before connecting', async () => {
  mode = 'redirect'; calls = []
  await assert.rejects(createBilibiliReader({ fetchImpl }).read('https://b23.tv/abc'), /HTTPS/)
  assert.equal(calls.length, 1); mode = ''
})
await test('subtitle external URL blocked before fetching', async () => {
  mode = 'badsubtitle'; calls = []
  const r = await createBilibiliReader({ fetchImpl }).read(bvid)
  assert.match(r.warnings.join(), /允许的/); assert.ok(!calls.some(u => u.includes('127.0.0.1'))); mode = ''
})
await test('actual streaming response limit, not only content-length', async () => {
  const reader = createBilibiliReader({ fetchImpl: async () => new Response('x'.repeat(2000001)) })
  await assert.rejects(reader.search('test'), /2MB/)
})
await test('HTTP and API failures are visible', async () => {
  await assert.rejects(createBilibiliReader({ fetchImpl: async () => new Response('', { status: 412 }) }).read(bvid), /HTTP 412/)
  await assert.rejects(createBilibiliReader({ fetchImpl: async () => Response.json({ code: -412, message: '风控' }) }).read(bvid), /-412/)
})
await test('host tools registered and render results with prompt guard', async () => {
  const tools = [], sections = []
  register({ tools: { register: t => tools.push(t) }, systemPrompt: { section: s => sections.push(s) } }, createBilibiliReader({ fetchImpl }))
  assert.deepEqual(tools.map(t => t.name), ['qq_card_video_links', 'qq_video_read', 'qq_video_search'])
  const result = await tools[1].execute({ url: bvid })
  assert.match(tools[1].output.render({}, result)[0].text, /transcript/)
  assert.match(sections[0].text(), /不可信/)
})
console.log(`${passed} checks passed; no live config or library modified`)

if (process.argv.includes('--live')) {
  const reader = createBilibiliReader()
  for (const [label, action] of [['known-video', () => reader.read('BV1xx411c7mD')], ['provided-card', () => reader.read(card)]]) {
    try {
      const r = await action()
      console.log('LIVE', label, JSON.stringify({ status: r.status, title: r.title, transcriptStatus: r.transcriptStatus, transcriptChars: r.transcript?.length, comments: r.comments?.length, danmaku: r.danmaku?.length, warnings: r.warnings, candidates: r.candidates }))
    } catch (error) { console.log('LIVE BLOCKED', label, error.message) }
  }
}
