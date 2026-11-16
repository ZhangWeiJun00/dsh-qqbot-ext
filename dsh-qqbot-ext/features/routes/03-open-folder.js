// POST /qqbot-ext/open-folder —— 在系统文件管理器里打开图库目录（或暂存区）。
//
// 浏览器没法打开本地文件夹，只能让宿主进程去调 shell。安全约束：
//   - 只允许打开「当前配置的图库目录」和「它对应的暂存区」，不接受任意路径
//   - 同源校验，且只收 POST
//   - 目录不存在就先建出来（刚配好还没收过表情的情况）
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { libraryDirOf, pendingDirOf, readConfig } from '../../lib/config.js'

/** 同源校验（Desktop 的 IPC 桥会去掉 origin 头，视作可信）。 */
function trusted(req) {
  const origin = req?.headers?.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  if (res && typeof res.writeHead === 'function') {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(payload)
    return undefined
  }
  return new Response(payload, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

/**
 * 用各平台的默认文件管理器打开目录。
 * 全程 execFile 传数组参数，不拼命令行字符串，避免路径里的空格/中文出问题。
 */
function openInFileManager(dir) {
  // 自检脚本会跑这条路由；不设这个开关的话，每跑一次测试就在桌面弹出几个窗口。
  if (process.env.QBE_NO_SHELL_OPEN === '1') {
    return Promise.resolve({ dryRun: true })
  }
  return new Promise((resolve, reject) => {
    const done = (error) => (error === null ? resolve() : reject(error))
    if (process.platform === 'win32') {
      // explorer 打不开目录时会返回非 0 退出码，但窗口其实是开着的，忽略退出码。
      execFile('explorer.exe', [dir], () => resolve())
      return
    }
    if (process.platform === 'darwin') {
      execFile('open', [dir], done)
      return
    }
    execFile('xdg-open', [dir], done)
  })
}

export function register(ctx) {
  ctx.webServer.register({
    kind: 'exact',
    path: '/qqbot-ext/open-folder',
    handler: async (req, res) => {
      if (!trusted(req)) return sendJson(res, 403, { ok: false, error: '来源不可信' })
      const method = String(req?.method ?? 'GET').toUpperCase()
      if (method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 POST' })

      // body 可选：{"target":"library"|"pending"}，默认图库
      let target = 'library'
      try {
        if (req && typeof req[Symbol.asyncIterator] === 'function') {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 4096) throw new Error('请求体过大')
            chunks.push(chunk)
          }
          const raw = Buffer.concat(chunks).toString('utf8').trim()
          if (raw !== '') {
            const parsed = JSON.parse(raw)
            if (parsed?.target === 'pending') target = 'pending'
          }
        }
      } catch {
        // body 坏了就按默认图库处理，不值得让按钮失效
      }

      const config = await readConfig()
      const dir = target === 'pending' ? pendingDirOf(config) : libraryDirOf(config)
      try {
        await mkdir(dir, { recursive: true })
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: `目录建不出来：${error instanceof Error ? error.message : String(error)}` })
      }
      try {
        await openInFileManager(dir)
        return sendJson(res, 200, { ok: true, dir, target })
      } catch (error) {
        return sendJson(res, 500, {
          ok: false,
          dir,
          error: `打不开文件管理器：${error instanceof Error ? error.message : String(error)}`,
        })
      }
    },
  })
}
