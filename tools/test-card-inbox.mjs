import assert from 'node:assert/strict'
import { createCardInbox } from '../dsh-qqbot-ext/lib/qq-card-inbox.js'
let clock = 0, reads = 0
const inbox = createCardInbox({ now: () => clock })
const msg = { content: '[卡片消息]小程序', messageId: 'one', get raw() { reads++; return { url: 'https://b23.tv/test' } } }
inbox.capture('group-a', msg)
assert.equal(reads, 0)
assert.equal(msg.content, '[卡片消息]小程序')
assert.equal(inbox.read('group-b').status, 'unavailable')
assert.equal(reads, 0)
assert.deepEqual(inbox.read('group-a').links, ['https://b23.tv/test'])
assert.equal(reads, 1)
assert.equal(inbox.read('group-a', 'other').status, 'unavailable')
clock = 600000
assert.equal(inbox.read('group-a').status, 'unavailable')
assert.equal(reads, 1)
clock = 0
for (let i=0;i<21;i++) inbox.capture('group-a', { ...msg, messageId: String(i) })
assert.equal(inbox.read('group-a','0').status, 'unavailable')
assert.equal(inbox.read('group-a','1').status, 'found')
console.log('PASS raw getter untouched during capture; explicit read only; content unchanged; peer isolation; TTL and retention bounded')
