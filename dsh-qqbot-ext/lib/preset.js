// 预设插件：dsh-qqbot-ext/preset
// 向 agentPresets 注册「QQ 机器人扩展」预设，dsh-qqbot 的 /preset 会自动列出。
// 组件清单在 lib/preset-plugins.js：标准预设全量 + 本扩展的 agent 组件。
export const name = 'dsh-qqbot-ext/preset'
export const inject = ['agentPresets']

export async function apply(ctx) {
  try {
    await ctx.agentPresets.register({
      id: 'qqbot-ext',
      name: 'QQ 机器人扩展',
      description: '标准组件 + dsh-qqbot-ext 扩展组件（人物扮演、表情包图库、调试工具等）。',
      order: 20,
      plugins: (await import('./preset-plugins.js')).PRESET_PLUGINS,
    })
    console.log('[dsh-qqbot-ext] 预设 qqbot-ext 已注册')
  } catch (err) {
    // 常见于热重载时 id 重复，不影响已有注册
    console.error('[dsh-qqbot-ext] 预设注册失败', err)
  }
}
