// 错误拦截与熔断隔离测试：状态机 + 拦截/闸门行为 + 配置校验。
// 跑法：node tools/test-error-guard.mjs
// 全部传 cfg 与假 sendTo，不触碰真实配置、图库或 QQ。
import assert from 'node:assert/strict'
import { interceptTurnError, noteTurnSuccess, breakerGate, breakerState, manualResetBreaker, breakerStatus, breakerCommand, adminOnlyAuth, _resetErrorGuard } from '../dsh-qqbot-ext/lib/error-guard.js'
import { CONFIG_DEFAULTS, normalizeConfig, decodeConfig, resolveAdminOpenid } from '../dsh-qqbot-ext/lib/config.js'

let passed = 0
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`) }
const cfg = (over = {}) => ({ ...CONFIG_DEFAULTS, ...over })
const failure = { code: 'MODEL_ERROR', message: 'provider exploded' }
function recorder({ failAdmin = false } = {}) {
  const sent = []
  const sendTo = async (target, text) => {
    if (failAdmin && target.scope === 'c2c' && target.targetId === 'admin') throw new Error('admin send blocked')
    sent.push({ target, text })
  }
  return { sent, sendTo }
}
const err = (sendTo, over = {}, now = 1000000) => interceptTurnError({
  failure, sessionKey: 'qqbot:app:group:g1', scope: 'group', peerId: 'g1',
  sendTo, fallbackAdmin: 'admin', logger: { warn() {} }, cfg: cfg(over), now,
})
const gate = (sendTo, key = 'qqbot:app:group:g1', peerId = 'g1', now = 1000000, over = {}) => breakerGate({
  sessionKey: key, scope: 'group', peerId, sendTo, logger: { warn() {} }, cfg: cfg(over), now,
})

// 1. 错误拦截：原会话友好提示 + 详情转发显式管理员
_resetErrorGuard()
{
  const { sent, sendTo } = recorder()
  const result = await err(sendTo, { adminOpenid: 'boss' })
  assert.equal(result.guarded, true)
  assert.equal(sent.length, 2)
  assert.deepEqual(sent[0].target, { scope: 'c2c', targetId: 'boss' })
  assert.match(sent[0].text, /MODEL_ERROR: provider exploded/)
  assert.match(sent[0].text, /qqbot:app:group:g1/)
  assert.deepEqual(sent[1].target, { scope: 'group', targetId: 'g1' })
  assert.equal(sent[1].text, CONFIG_DEFAULTS.errorNoticeText)
  ok('turn error forwards detail to admin and notices the original chat')
}

// 2. 管理员留空 → 回退官方 c2c 白名单第一个
_resetErrorGuard()
{
  const { sent, sendTo } = recorder()
  await err(sendTo, { adminOpenid: '' })
  assert.deepEqual(sent[0].target, { scope: 'c2c', targetId: 'admin' })
  ok('empty admin openid falls back to the first c2cAllow entry')
}

// 3. 提示正文留空 → 原会话静默，仍转发
_resetErrorGuard()
{
  const { sent, sendTo } = recorder()
  await err(sendTo, { errorNoticeText: '  ' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].target.scope, 'c2c')
  ok('empty notice text silences the chat but keeps forwarding')
}

// 4. 总开关关闭 → 完全回到上游（不拦截、不计数）
_resetErrorGuard()
{
  const { sent, sendTo } = recorder()
  const result = await err(sendTo, { errorGuardEnabled: false })
  assert.equal(result.guarded, false)
  assert.equal(sent.length, 0)
  assert.equal(breakerState().consecutive, 0)
  ok('disabled guard leaves everything untouched')
}

// 5. 连续 3 次错误跳闸 + 闸门节流提示
_resetErrorGuard()
{
  const { sent, sendTo } = recorder()
  const r1 = await err(sendTo, {}, 1000000)
  const r2 = await err(sendTo, {}, 1001000)
  const r3 = await err(sendTo, {}, 1002000)
  assert.equal(r1.justTripped, false)
  assert.equal(r2.justTripped, false)
  assert.equal(r3.justTripped, true)
  assert.ok(sent.some((m) => m.text.includes('熔断触发') && m.target.targetId === 'admin'))
  const before = sent.length
  assert.equal(await gate(sendTo, 'qqbot:app:group:g1', 'g1', 1003000), true, 'tripped gate blocks')
  assert.equal(sent.length, before + 1, 'one throttled notice')
  assert.equal(await gate(sendTo, 'qqbot:app:group:g1', 'g1', 1030000), true)
  assert.equal(sent.length, before + 1, 'same key within 60s gets no second notice')
  assert.equal(await gate(sendTo, 'qqbot:app:group:g2', 'g2', 1031000), true)
  assert.equal(sent.length, before + 2, 'another key gets its own notice')
  ok('three consecutive errors trip the breaker with throttled per-chat notices')
}

// 6. 无冷却：跳闸后一直拦截，在途成功回合不自动恢复，只能人工合闸
_resetErrorGuard()
{
  const { sent, sendTo } = recorder()
  for (let i = 0; i < 3; i += 1) await err(sendTo, {}, 1000000 + i * 1000)
  assert.equal(await gate(sendTo, 'qqbot:app:group:g1', 'g1', 1002000 + 86400000), true, 'still tripped a day later (no cooldown)')
  await noteTurnSuccess({ sendTo, fallbackAdmin: 'admin', logger: { warn() {} }, cfg: cfg(), now: 1002000 + 90000000 })
  assert.equal(breakerState().trippedAt, 1002000, 'in-flight success does not close the breaker')
  assert.ok(!sent.some((m) => m.text.includes('熔断恢复')), 'no auto-recovery notification')
  assert.equal(await gate(sendTo, 'qqbot:app:group:g1', 'g1', 1002000 + 90000001), true)
  manualResetBreaker()
  assert.equal(await gate(sendTo, 'qqbot:app:group:g1', 'g1', 1002000 + 90000002), false, 'only manual reset opens the gate')
  ok('no cooldown: tripped until admin manual reset, in-flight success never auto-recovers')
}

// 7. 跳闸期间在途错误：照常上报但不重复跳闸、不改变跳闸时刻
_resetErrorGuard()
{
  const { sent, sendTo } = recorder()
  for (let i = 0; i < 3; i += 1) await err(sendTo, {}, 1000000 + i * 1000)
  const tripNotices = sent.filter((m) => m.text.includes('熔断触发')).length
  const late = await err(sendTo, {}, 2000000)
  assert.equal(late.justTripped, false)
  assert.equal(breakerState().trippedAt, 1002000, 'trip timestamp unchanged')
  assert.equal(sent.filter((m) => m.text.includes('熔断触发')).length, tripNotices, 'no duplicate trip notice')
  assert.ok(sent.some((m) => m.text.includes('MODEL_ERROR') && m.target.targetId === 'admin'), 'late error still forwarded')
  assert.equal(await gate(sendTo, 'qqbot:app:group:g1', 'g1', 2001000), true)
  ok('in-flight errors while tripped report without re-tripping')
}

// 8. 阈值 0 = 不熔断
_resetErrorGuard()
{
  const { sendTo } = recorder()
  for (let i = 0; i < 10; i += 1) await err(sendTo, { breakerThreshold: 0 }, 1000000 + i * 1000)
  assert.equal(breakerState().trippedAt, 0)
  assert.equal(await gate(sendTo, 'qqbot:app:group:g1', 'g1', 1010000, { breakerThreshold: 0 }), false)
  ok('threshold zero disables the breaker')
}

// 9. 成功回合清零连续计数（未跳闸时）
_resetErrorGuard()
{
  const { sendTo } = recorder()
  await err(sendTo, {}, 1000000)
  await err(sendTo, {}, 1001000)
  await noteTurnSuccess({ sendTo, fallbackAdmin: 'admin', logger: { warn() {} }, cfg: cfg(), now: 1002000 })
  await err(sendTo, {}, 1003000)
  await err(sendTo, {}, 1004000)
  assert.equal(breakerState().trippedAt, 0, '2+success+2 never reaches 3 consecutive')
  ok('successful turns reset the consecutive counter')
}

// 10. 管理员转发失败不阻断原会话提示
_resetErrorGuard()
{
  const { sent, sendTo } = recorder({ failAdmin: true })
  const result = await err(sendTo, { adminOpenid: 'admin' })
  assert.equal(result.guarded, true)
  assert.ok(sent.some((m) => m.target.scope === 'group'), 'chat notice still delivered')
  ok('admin forward failure does not break the chat notice')
}

// 11. 配置校验
{
  const next = normalizeConfig({ errorGuardEnabled: false, errorNoticeText: '忙', adminOpenid: 'ABC_123-x', breakerThreshold: 5 }, CONFIG_DEFAULTS)
  assert.equal(next.errorGuardEnabled, false)
  assert.equal(next.breakerThreshold, 5)
  assert.throws(() => normalizeConfig({ errorGuardEnabled: 'yes' }, CONFIG_DEFAULTS), /布尔值/)
  assert.throws(() => normalizeConfig({ adminOpenid: 'bad openid!' }, CONFIG_DEFAULTS), /字母/)
  assert.throws(() => normalizeConfig({ breakerThreshold: 101 }, CONFIG_DEFAULTS), /0–100/)
  assert.throws(() => normalizeConfig({ errorNoticeText: 'x'.repeat(501) }, CONFIG_DEFAULTS), /格式或长度/)
  ok('config validation accepts valid fields and rejects invalid ones')
}

{
  const legacy = decodeConfig(JSON.stringify({ errorForwardOpenid: ' old-admin ', breakerThreshold: 9 }));
  assert.equal(legacy.adminOpenid, 'old-admin');
  assert.equal(legacy.breakerThreshold, 9);
  assert.equal(Object.hasOwn(legacy, 'errorForwardOpenid'), false);
  assert.equal(normalizeConfig({ errorForwardOpenid: 'stale' }, legacy).adminOpenid, 'old-admin');
  const cleared = decodeConfig(JSON.stringify({ adminOpenid: '', errorForwardOpenid: 'old-admin' }));
  assert.equal(resolveAdminOpenid(cleared, 'fallback'), 'fallback');
  ok('legacy configuration migrates and an explicit clear takes precedence');
}

// 12. /resume 人工合闸：跳闸中立即恢复，闸门放行（无参数直接合闸，reset 参数兼容）
_resetErrorGuard()
{
  const { sendTo } = recorder()
  for (let i = 0; i < 3; i += 1) await err(sendTo, {}, 1000000 + i * 1000)
  assert.equal(await gate(sendTo, 'qqbot:app:group:g1', 'g1', 1003000), true)
  const cmd = breakerCommand({ config: {}, logger: { info() {} }, authorized: () => true, cfg: cfg() })
  assert.ok((Array.isArray(cmd.name) ? cmd.name : [cmd.name]).includes('resume'), 'command named /resume')
  const reply = await cmd.handler({ command: { raw: '' }, message: { senderId: 'admin' } })
  assert.match(reply, /已人工合闸/)
  assert.equal(breakerState().trippedAt, 0)
  assert.equal(breakerState().consecutive, 0)
  assert.equal(await gate(sendTo, 'qqbot:app:group:g1', 'g1', 1004000), false, 'gate passes after manual reset')
  const again = await cmd.handler({ command: { raw: 'reset' }, message: { senderId: 'admin' } })
  assert.match(again, /没有跳闸/)
  ok('/resume manually closes the breaker and the gate passes')
}

// 13. /resume status 状态查询与用法提示
_resetErrorGuard()
{
  const { sendTo } = recorder()
  const cmd = breakerCommand({ config: {}, logger: { info() {} }, authorized: () => true, cfg: cfg() })
  const idle = await cmd.handler({ command: { raw: 'status' }, message: { senderId: 'admin' } })
  assert.match(idle, /正常/)
  assert.match(idle, /0\/3/)
  for (let i = 0; i < 3; i += 1) await err(sendTo, {}, 1000000 + i * 1000)
  const tripped = await cmd.handler({ command: { raw: 'status' }, message: { senderId: 'admin' } })
  assert.match(tripped, /熔断中/)
  assert.match(tripped, /无自动恢复/)
  assert.match(tripped, /人工合闸：\/resume/)
  const usage = await cmd.handler({ command: { raw: 'bogus' }, message: { senderId: 'admin' } })
  assert.match(usage, /用法/)
  const view = breakerStatus(cfg())
  assert.equal(view.tripped, true)
  assert.equal(view.trippedAt, 1002000)
  ok('/resume status reports status, trip time and usage')
}

// 14. 关闭/阈值为 0 时的状态文案
_resetErrorGuard()
{
  const cmdOff = breakerCommand({ config: {}, logger: {}, authorized: () => true, cfg: cfg({ errorGuardEnabled: false }) })
  assert.match(await cmdOff.handler({ command: { raw: 'status' }, message: {} }), /已关闭/)
  const cmdZero = breakerCommand({ config: {}, logger: {}, authorized: () => true, cfg: cfg({ breakerThreshold: 0 }) })
  assert.match(await cmdZero.handler({ command: { raw: 'status' }, message: {} }), /阈值为 0/)
  ok('status text covers disabled guard and zero threshold')
}

// 15. /resume 仅限管理员（同步鉴权，fail-closed）
{
  const official = { access: { c2cAllow: ['boss', 'other'] } }
  const auth = adminOnlyAuth({ config: official, logger: { warn() {} }, cfg: cfg() })
  assert.equal(auth({ message: { senderId: 'boss' } }), true, 'first allowlist entry is the admin')
  assert.equal(typeof auth({ message: { senderId: 'other' } }), 'string', 'other allowlisted users are denied')
  assert.match(auth({ message: { senderId: 'other' } }), /仅限管理员/)
  assert.match(auth({ message: {} }), /仅限管理员/)
  const overridden = adminOnlyAuth({ config: official, logger: { warn() {} }, cfg: cfg({ adminOpenid: 'custom' }) })
  assert.equal(overridden({ message: { senderId: 'custom' } }), true, 'adminOpenid override honored')
  assert.match(overridden({ message: { senderId: 'boss' } }), /仅限管理员/)
  const noAdmin = adminOnlyAuth({ config: { access: { c2cAllow: [] } }, logger: { warn() {} }, cfg: cfg() })
  assert.match(noAdmin({ message: { senderId: 'boss' } }), /仅限管理员/, 'no resolvable admin → fail closed')
  ok('/resume authorization is admin-only and fail-closed')
}

console.log(`${passed} isolated checks passed (error guard + breaker; no real config/library/QQ touched)`)