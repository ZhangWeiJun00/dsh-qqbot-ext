// 功能文件装载器：扫目录下 *.js（_ 开头的跳过），按文件名排序，
// 依次 import 并调用其 register(ctx)（或 default 导出）。
// 单个功能挂了不影响其他功能，报错只打日志。
// 加新功能 = 往对应目录丢一个文件，重启 DSH 即生效（file: 软链安装时）。
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export async function loadFeatures(ctx, dirUrl) {
  const dir = fileURLToPath(dirUrl)
  let entries
  try {
    entries = await readdir(dir)
  } catch {
    // 目录不存在 = 这层没有功能，安静跳过
    return
  }
  const files = entries.filter((f) => f.endsWith('.js') && !f.startsWith('_')).sort()
  for (const file of files) {
    try {
      const mod = await import(new URL(file, dirUrl))
      const register = typeof mod.register === 'function' ? mod.register : mod.default
      if (typeof register !== 'function') {
        console.warn(`[dsh-qqbot-ext] feature ${file} 没有 register(ctx) 导出，跳过`)
        continue
      }
      await register(ctx)
    } catch (err) {
      console.error(`[dsh-qqbot-ext] feature 加载失败: ${file}`, err)
    }
  }
}
