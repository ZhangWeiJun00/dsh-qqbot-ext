// 客户端合并：Web boot graph 每个包只有一个条目（entry name == package name），
// 一个模块脚本里第二次 window.__ModuleLoader__.load({id:'dsh-qqbot-ext'}) 注册的
// factory 没有对应 boot 条目，永远不会激活——面板因此不显示。
// 正确做法：捕获两份注册对象，合并成一次以包名为 id 的 .load：
// factory 依次执行上游与扩展 factory，inject 取并集，apply 串联、cleanup 逆序。
export const LOAD_ANCHOR = 'window.__ModuleLoader__.load({'

/** 把「.load({ … });」整体改写成「const 名字 = { … };」，只动首尾两处。 */
function captureRegistration(source, name, closeToken, fixedClose) {
  if (!source.startsWith(LOAD_ANCHOR)) throw new Error(`${name}: registration anchor changed`)
  const close = source.lastIndexOf(closeToken)
  if (close === -1) throw new Error(`${name}: registration close not found`)
  const tail = source.slice(close + closeToken.length).trim()
  if (tail !== '' && !/^\/\/# sourceMappingURL=.*$/.test(tail)) {
    throw new Error(`${name}: code after registration; update the merge for the new upstream shape`)
  }
  return source.slice(0, close).replace(LOAD_ANCHOR, `const ${name} = {`) + fixedClose + source.slice(close + closeToken.length)
}

export function mergeClient(upstreamClient, extClient) {
  const upstream = captureRegistration(upstreamClient, '__qqUpstreamReg', '});', '};')
  const ext = captureRegistration(extClient, '__qqExtReg', '})', '}')
  return upstream
    + '\n\n// Local QQ extension settings and library panel (captured; merged below)\n'
    + ext
    + `
// Single package-id registration: run both factories, union inject, chain apply/cleanup.
window.__ModuleLoader__.load({
  ...__qqUpstreamReg,
  factory: (require) => {
    const upstream = __qqUpstreamReg.factory(require)
    const ext = __qqExtReg.factory(require)
    const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])]
    return {
      ...upstream,
      inject: union(upstream.inject, ext.inject),
      apply(ctx) {
        const cleanups = []
        for (const mod of [upstream, ext]) {
          if (typeof mod.apply !== 'function') continue
          const cleanup = mod.apply(ctx)
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        }
        return () => {
          for (const cleanup of cleanups.reverse()) {
            try { cleanup() } catch (err) { console.error('[local-qqbot] client cleanup failed', err) }
          }
        }
      },
    }
  },
})
`
}