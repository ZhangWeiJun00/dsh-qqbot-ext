// DSH stream protocol: reasoning is not answer text; block-end is authoritative.
export async function collectVisionText(stream, limit = 32000) {
  const blocks = new Map()
  let size = 0
  for await (const chunk of stream) {
    if (chunk.type === 'finish') {
      const reason = chunk.reason
      if (reason?.kind === 'error' || reason?.kind === 'aborted') throw new Error(reason.failure?.message || '视觉模型调用失败或中断')
      if (reason?.kind === 'max-tokens') throw new Error('视觉模型输出达到 token 上限，请提高输出 token 上限后重试')
    }
    if (chunk.type === 'block-start' && !blocks.has(chunk.index)) blocks.set(chunk.index, {type:chunk.blockType,text:'',closed:false})
    if (chunk.type === 'text-delta') {
      const block = blocks.get(chunk.index) || {type:'text',text:'',closed:false}
      if (!block.closed && block.type === 'text') {block.text += chunk.text; size += chunk.text.length}
      blocks.set(chunk.index,block)
    }
    if (chunk.type === 'block-end' && !blocks.get(chunk.index)?.closed) {
      const block = chunk.block
      const text = block?.type === 'text' ? block.text : ''
      size += text.length - (blocks.get(chunk.index)?.text.length || 0)
      blocks.set(chunk.index,{type:block?.type,text,closed:true})
    }
    if (size > limit) throw new Error('视觉模型正文输出过长')
  }
  const text = [...blocks.values()].filter(block => block.type === 'text').map(block=>block.text).join('\n').trim()
  if (!text) throw new Error('视觉模型没有返回最终正文；可能只输出了思考内容，请提高 token 上限或关闭模型思考后重试')
  return text
}
