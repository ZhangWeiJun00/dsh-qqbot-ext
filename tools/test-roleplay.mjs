import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createRoleplayStore, importRoleplayCard, normalizeRoleplay, qqConversationKey, resolveRoleplayCard, buildRoleplayPrompt } from '../dsh-qqbot-ext/lib/roleplay.js'
import { register as registerHost } from '../dsh-qqbot-ext/features/host/05-roleplay.js'
import { register as registerRoute } from '../dsh-qqbot-ext/features/routes/05-roleplay.js'
import { COMPONENTS } from '../dsh-qqbot-ext/lib/components.js'

let passed = 0
const test = async (name, run) => { await run(); console.log(`✓ ${++passed}. ${name}`) }
const temp = await mkdtemp(join(tmpdir(), 'qbe-roleplay-'))
const path = join(temp, 'roleplay.json')
const store = createRoleplayStore(path)
const a = importRoleplayCard('性格：嘴硬\n喜欢白饭', '小鲸鱼')
const b = importRoleplayCard(JSON.stringify({spec:'chara_card_v2',data:{name:'旅行者',description:'叫 {{char}}',personality:'沉静',scenario:'旅途中',first_mes:'你好',mes_example:'<START>你好',system_prompt:'说短句'}}))
const config = { enabled:true, defaultCardId:a.id, cards:[a,b], bindings:[{conversationKey:'qqbot:app:group:123',cardId:b.id},{conversationKey:'qqbot:app:c2c:456',cardId:''}] }
await test('首次读取为关闭状态，不创建真实配置', async () => assert.deepEqual(await store.read(), {enabled:false,defaultCardId:'',cards:[],bindings:[]}))
await test('文本卡与 Tavern JSON 卡提取叙事字段', () => {assert.equal(a.name,'小鲸鱼');assert.match(b.content,/性格：\n沉静/);assert.match(b.content,/开场示例/);assert.equal(b.name,'旅行者')})
await test('兼容 v1、v3 与原生卡片 JSON', () => {
  for(const source of [{name:'v1',description:'角色'},{spec:'chara_card_v3',data:{name:'v3',personality:'慢热'}},{name:'原生',content:'正文'}]) assert.ok(importRoleplayCard(JSON.stringify(source)).content)
})
await test('无效 JSON、空卡和超限卡被拒绝', () => {
  for(const source of ['{bad','{}','[]','', 'a'.repeat(60001)]) assert.throws(()=>importRoleplayCard(source))
})
await test('原子保存并跨实例读回', async () => {await store.write(config);assert.deepEqual(await createRoleplayStore(path).read(),config)})
await test('默认、指定与停用绑定独立生效', () => {
  assert.equal(resolveRoleplayCard(config,'qqbot:app:c2c:789').id,a.id)
  assert.equal(resolveRoleplayCard(config,'qqbot:app:group:123').id,b.id)
  assert.equal(resolveRoleplayCard(config,'qqbot:app:c2c:456'),undefined)
  assert.equal(resolveRoleplayCard({...config,enabled:false},'qqbot:app:group:123'),undefined)
  assert.equal(resolveRoleplayCard(config,'session-work'),undefined)
})
await test('重复 ID、悬空绑定与非 QQ key 被拒绝', () => {
  for(const changed of [{cards:[a,a]}, {defaultCardId:'absent'}, {bindings:[{conversationKey:'qqbot:app:group:1',cardId:'absent'}]}, {bindings:[{conversationKey:'session-any',cardId:a.id}]}, {bindings:[config.bindings[0],config.bindings[0]]}, {enabled:'yes'}]) assert.throws(()=>normalizeRoleplay({...config,...changed}))
})
await test('非法写入不覆盖已保存卡片', async () => {await assert.rejects(store.write({...config,defaultCardId:'bad'}));assert.deepEqual(await store.read(),config)})
await test('并发保存串行完成，文件仍可解析', async () => {await Promise.all([store.write({...config,enabled:false}),store.write(config)]);assert.deepEqual(await store.read(),config)})
await test('识别官方 QQ 目标，仅信任会话服务', () => {
  const ctx={get:()=>({conversationKey:()=> 'qqbot:app:group:openid'})}
  assert.equal(qqConversationKey(ctx,{}),'qqbot:app:group:openid')
  assert.equal(qqConversationKey({get:()=>({conversationKey:()=> 'session-web'})},{}),undefined)
})
const agent = {session:{id:'session-official-qq'}}
const ctx = { get:()=>({conversationKey:current=>current===agent ? 'qqbot:app:group:123' : undefined}) }
const platform = [{name:'qqbot:scope-prompt',order:90,text:'QQ channel'}]
await test('仅接受官方会话映射，拒绝其他协议及伪造会话 ID', () => {
  const otherKey='onebot:group:123'
  assert.equal(qqConversationKey({get:()=>({conversationKey:()=>otherKey})},agent),undefined)
  assert.equal(resolveRoleplayCard(config,otherKey),undefined)
  assert.throws(()=>normalizeRoleplay({...config,bindings:[{conversationKey:otherKey,cardId:a.id}]}))
  assert.equal(qqConversationKey({get:()=>undefined},{session:{id:'onebot-group-123'}},[{name:'channel:dsh-onebot'}]),undefined)
  assert.equal(qqConversationKey({get:()=>undefined},{session:{id:'qqbot:app:group:123'}}),undefined)
})
await test('普通 Web 会话与子代理不继承角色', () => {
  assert.equal(qqConversationKey(ctx,{session:{id:'onebot-group-123'}},[]),undefined)
  assert.equal(qqConversationKey(ctx,{session:{id:'session-123'}},platform),undefined)
  assert.equal(qqConversationKey(ctx,undefined,platform),undefined)
})
await test('提示替换 char 占位符并保留平台权限说明', () => {const prompt=buildRoleplayPrompt(b);assert.match(prompt,/叫 旅行者/);assert.match(prompt,/权限限制/);assert.match(prompt,/旧角色/);assert.match(prompt,/不自动发送开场示例/)})
await test('角色卡宏和名称不会残留宿主模板变量', () => {
  const prompt = buildRoleplayPrompt({name:'角色 {{unknown_name}}',content:'{{char}} 对 {{user}} 说：{{ USER }}；{{ Char }}；{{unknown}}；{{provider}}；{{model}}；{{nested::{{user}}}}'})
  assert.doesNotMatch(prompt,/\{\{|\}\}/)
  assert.match(prompt,/角色 ｛｛unknown_name｝｝ 对 当前对话者/)
  assert.match(prompt,/｛｛unknown｝｝/)
  assert.match(prompt,/｛｛provider｝｝/)
  assert.match(prompt,/｛｛model｝｝/)
  assert.doesNotMatch(buildRoleplayPrompt(b),/\{\{|\}\}/)
})
let assemble
registerHost({...ctx,on(name,fn){assert.equal(name,'system-prompt/assemble');assemble=fn}},store)
const assembled={sections:[...platform,{name:'workspace',order:100,text:'existing'}],other:'retained'}
await test('官方 QQ 挂载追加角色，保留宿主字段和平台段', async () => {
  const result=await assemble({}, {agent}, async()=>assembled)
  assert.equal(result.other,'retained');assert.equal(result.sections.length,3);assert.match(result.sections.at(-1).text,/旅行者/);assert.equal(assembled.sections.length,2)
})
await test('保存角色切换和关闭在下一次组装即时生效', async () => {
  await store.write({...config,bindings:[]})
  assert.match((await assemble({}, {agent}, async()=>assembled)).sections.at(-1).text,/小鲸鱼/)
  await store.write({...config,enabled:false})
  assert.equal(await assemble({}, {agent}, async()=>assembled),assembled)
  await store.write(config)
})
await test('非 QQ 组装不读取卡片也不注入', async () => {
  let hook,reads=0
  registerHost({...ctx,on(_name,fn){hook=fn}},{read(){reads++;throw Error('unexpected')}})
  assert.equal(await hook({}, {agent:{session:{id:'session-web'}}},async()=>assembled),assembled)
  assert.equal(reads,0)
})
let handler
registerRoute({webServer:{register(route){assert.equal(route.path,'/qqbot-ext/roleplay');handler=route.handler}}},store)
async function request(method,body,origin) {
  const req=Readable.from(body === undefined ? [] : [Buffer.from(typeof body==='string'?body:JSON.stringify(body))])
  req.method=method;req.headers={host:'127.0.0.1:65109',...(origin?{origin}:{})}
  let status,payload
  await handler(req,{writeHead(code){status=code},end(raw){payload=JSON.parse(raw)}})
  return {status,...payload}
}
await test('路由 GET/POST 读写同一存储', async () => {
  assert.deepEqual((await request('GET')).config,config)
  const revision=(await request('GET')).revision
  assert.equal((await request('POST',{config:{...config,enabled:false},revision})).status,200)
  assert.equal((await store.read()).enabled,false)
})
await test('旧页面和并发陈旧保存被拒绝，已保存角色不丢失', async () => {
  const revision=(await request('GET')).revision
  const changed={...config,cards:[...config.cards,{id:'new-card',name:'新角色',content:'新角色正文'}]}
  const results=await Promise.all([request('POST',{config:changed,revision}),request('POST',{config,revision})])
  assert.equal(results[0].status,200);assert.equal(results[1].status,409)
  assert.ok((await store.read()).cards.some(card=>card.id==='new-card'))
  assert.equal((await request('POST',{config})).status,400)
})
await test('导入接口仅解析草稿，不修改配置', async () => {
  const before=await readFile(path,'utf8')
  assert.equal((await request('POST',{action:'import',name:'导入角色',content:'爱吃饭'})).card.name,'导入角色')
  assert.equal(await readFile(path,'utf8'),before)
})
await test('跨源、非法方法、坏 JSON、超限请求被拒绝', async () => {
  assert.equal((await request('POST',{config},'https://evil.example')).status,403)
  assert.equal((await request('DELETE')).status,405)
  assert.equal((await request('POST','{')).status,400)
  assert.equal((await request('POST',{action:'other'})).status,400)
  assert.equal((await request('POST','x'.repeat(5*1024*1024+1))).status,400)
})
await test('Fetch Request 接口与同源检查兼容', async () => {
  const response=await handler(new Request('http://127.0.0.1:65109/qqbot-ext/roleplay',{headers:{origin:'http://127.0.0.1:65109'}}))
  assert.equal(response.status,200);assert.equal((await response.json()).ok,true)
})
await test('损坏配置报错且保留原始数据', async () => {
  await writeFile(path,'{broken','utf8')
  await assert.rejects(store.read());assert.equal((await request('GET')).status,400);assert.equal(await readFile(path,'utf8'),'{broken')
})
await test('模块已注册为独立可编辑组件', () => {assert.equal(COMPONENTS.find(c=>c.id==='roleplay').editable,true)})
console.log(`\n${passed} checks passed. Isolated files: ${temp}`)
