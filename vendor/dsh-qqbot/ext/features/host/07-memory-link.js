import { qqConversationKey } from '../../lib/roleplay.js'
import { createMemoryStore, setMember, removeMember, addFact, removeFact } from '../../lib/memory-store.js'
import { createQqMemoryContribution } from '../../lib/mnemon-qq-source.js'
import { installMemoryCapture } from '../../lib/memory-capture.js'

// Mnemon owns projection and write authority; no raw transcript or global-memory search is injected here.
export function register(ctx, options = {}) {
  const store = options.store ?? createMemoryStore({})
  const keyOf = agent => qqConversationKey(ctx, agent)
  const resolveScope = scope => {
    const agents = ctx.get('agents')
    const agent = agents?.get?.(scope.agentId ?? scope.sessionId)
    return keyOf(agent)
  }
  const canWrite = () => options.config?.writeEnabled !== false
  const contribution = createQqMemoryContribution({ store, resolveScope, canWrite })
  ctx.effect(() => ctx.mnemonMemory.installContributions(contribution, { instanceId: 'qqbot-ext-memory' }))
  installMemoryCapture(ctx, { store, resolveScope, config: options.config })

  const resultSchema = { type: 'object', additionalProperties: true }
  const tool = (name, description, properties, execute) => ctx.tools.register({
    name, description,
    parameters: { type: 'object', properties, required: ['action'], additionalProperties: false },
    output: { schema: resultSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const key = keyOf(exec?.agent)
      if (!key) throw new Error('仅当前官方 QQ 会话可用')
      return execute(key, args)
    },
  })
  tool('qq_member_note', '管理当前 QQ 会话的成员档案。仅记明确告知的外号/偏好，不推测身份；按当前群或私聊隔离。', {
    action: { type: 'string', enum: ['set','get','list','delete'] }, memberId: { type: 'string' }, note: { type: 'string' },
  }, async (key, args) => {
    if (args.action === 'list' || args.action === 'get') {
      const { block } = await store.readPeer(key)
      return args.action === 'list' ? { members: block.members } : { member: Object.hasOwn(block.members, args.memberId) ? block.members[args.memberId] : null }
    }
    if (!canWrite()) throw new Error('QQ 记忆写入已关闭')
    const saved = await store.mutatePeer(key, block => {
      if (!canWrite()) throw new Error('QQ 记忆写入已关闭')
      if (args.action === 'set') return setMember(block, args.memberId, args.note)
      if (args.action === 'delete') return removeMember(block, args.memberId)
      throw new Error('未知 action')
    })
    return { result: saved.result, receipt: saved.receipt }
  })
  tool('qq_remember', '管理当前 QQ 会话明确确认的长期事实。只存精炼，不存聊天原文；其他会话不可访问。', {
    action: { type: 'string', enum: ['add','remove','list'] }, text: { type: 'string' },
  }, async (key, args) => {
    if (args.action === 'list') return { facts: (await store.readPeer(key)).block.facts }
    if (!canWrite()) throw new Error('QQ 记忆写入已关闭')
    const saved = await store.mutatePeer(key, block => {
      if (!canWrite()) throw new Error('QQ 记忆写入已关闭')
      if (args.action === 'add') return addFact(block, args.text)
      if (args.action === 'remove') return removeFact(block, args.text)
      throw new Error('未知 action')
    })
    return { result: saved.result, receipt: saved.receipt }
  })
  return { store, resolveScope }
}
