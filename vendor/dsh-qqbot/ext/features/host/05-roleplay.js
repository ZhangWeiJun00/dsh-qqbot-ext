import { roleplayStore, qqConversationKey, resolveRoleplayCard, buildRoleplayPrompt } from '../../lib/roleplay.js'

export function register(ctx, store = roleplayStore) {
  let lastError = ''
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const key = qqConversationKey(ctx, context?.agent, assembled.sections)
    if (!key) return assembled
    try {
      const card = resolveRoleplayCard(await store.read(), key)
      lastError = ''
      if (!card) return assembled
      return {
        ...assembled,
        sections: [
          ...(assembled.sections ?? []).filter(section => section.name !== 'qqbot-ext:roleplay'),
          { name: 'qqbot-ext:roleplay', order: 9010, text: buildRoleplayPrompt(card) },
        ],
      }
    } catch (error) {
      const message = String(error.message ?? error)
      if (lastError !== message) console.error('[dsh-qqbot-ext] 人设卡加载失败：', message)
      lastError = message
      return assembled
    }
  })
}
