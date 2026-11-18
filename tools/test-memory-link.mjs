import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryStore } from '../dsh-qqbot-ext/lib/memory-store.js'
import { register } from '../dsh-qqbot-ext/features/host/07-memory-link.js'
import { parseMemoryCandidates, installMemoryCapture } from '../dsh-qqbot-ext/lib/memory-capture.js'
const root = await mkdtemp(join(tmpdir(), 'qq-memory-link-'))
try {
 const store = createMemoryStore({path:join(root,'memory.json')})
 const K='qqbot:app:c2c:alice', K2='qqbot:app:group:team'
 const a={id:'a',session:{header:{id:'s'}}}, b={id:'b'}
 const tools=new Map(), listeners=new Map(), cleanups=[]
 let contributions
 const config={writeEnabled:true,captureEnabled:false}
 const ctx={
  get(n){if(n==='agents')return {get:id=>id==='a'||id==='s'?a:id==='b'?b:undefined};if(n==='qqbotExtStickerSender')return {conversationKey:agent=>agent===a?K:agent===b?K2:undefined}},
  tools:{register:t=>{tools.set(t.name,t);return ()=>tools.delete(t.name)}},
  mnemonMemory:{installContributions(c){contributions=c;return ()=>{contributions=null}}},
  effect(fn){const cleanup=fn();if(typeof cleanup==='function')cleanups.push(cleanup)},
  on(n,fn){listeners.set(n,fn);return ()=>listeners.delete(n)},logger:console,
 }
 const installed=register(ctx,{store,config})
 assert.ok(contributions.sources.length)
 assert.equal(await installed.resolveScope({sessionId:'s'}),K)
 await tools.get('qq_member_note').execute({action:'set',memberId:'u',note:'喜欢米饭'},{agent:a})
 assert.equal((await tools.get('qq_member_note').execute({action:'get',memberId:'u'},{agent:a})).member.note,'喜欢米饭')
 assert.equal((await tools.get('qq_member_note').execute({action:'get',memberId:'u'},{agent:b})).member,null)
 await tools.get('qq_remember').execute({action:'add',text:'用户喜欢简短回复'},{agent:a})
 assert.equal((await store.readPeer(K)).block.facts.length,1)
 assert.equal((await store.readPeer(K2)).block.facts.length,0)
 config.writeEnabled=false
 await assert.rejects(()=>tools.get('qq_remember').execute({action:'add',text:'blocked'},{agent:a}),/关闭/)
 await assert.rejects(()=>tools.get('qq_remember').execute({action:'list'},{}),/QQ/)
 assert.equal(parseMemoryCandidates('{"facts":[]}',[]).length,0)
 assert.deepEqual(parseMemoryCandidates(JSON.stringify({facts:[{text:'偏好短回复',message:0,evidence:'以后请简短回复'}]}),['以后请简短回复']),['偏好短回复'])
 assert.equal(parseMemoryCandidates(JSON.stringify({facts:[{text:'猜测',message:0,evidence:'根本没说过'}]}),['以后请简短回复']).length,0)
 assert.equal(parseMemoryCandidates(JSON.stringify({facts:[{text:'密码1234',message:0,evidence:'密码1234'}]}),['密码1234']).length,0)
 cleanups.forEach(fn=>fn())
 // A successful turn triggers extraction from user text only, once; no replay writes.
 let eventHandler, callCount=0, resolveDone
 const done=new Promise(resolve=>resolveDone=resolve)
 const captureStore={mutatePeer:async(...args)=>{const result=await store.mutatePeer(...args);resolveDone();return result}}
 const capCtx={effect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup)},on:(n,fn)=>eventHandler=fn,
  get:n=>n==='llm'?{stream:async function* (req){callCount++;assert.equal(req.provider,'p');assert.ok(!JSON.stringify(req.messages).includes('assistant private text'));yield {type:'text-delta',index:0,text:'{"facts":[{"text":"用户喜欢米饭","message":0,"evidence":"我喜欢吃米饭"}]}'} }}:undefined,logger:console}
 installMemoryCapture(capCtx,{store:captureStore,resolveScope:async()=>K,config:{}})
 const end={type:'turn/end',seq:3,data:{turn:1,reason:{kind:'complete'}}}
 const session={header:{id:'s'},requestHeader:()=>({config:{provider:'p',model:'m'}}),snapshotEvents:()=>[
  {type:'turn/start',seq:0,data:{turn:1}}, {type:'user/message',seq:1,data:{message:{content:[{type:'text',text:'我喜欢吃米饭'}]}}},
  {type:'assistant/message',seq:2,data:{message:{content:[{type:'text',text:'assistant private text'}]}}},end]}
 eventHandler(session,end);await Promise.race([done,new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('capture timeout')),2000);t.unref()})])
 assert.equal(callCount,1);assert.ok((await store.readPeer(K)).block.facts.some(f=>f.text==='用户喜欢米饭'))
 eventHandler(session,end);assert.equal(callCount,1)
 cleanups.forEach(fn=>fn())
 console.log('PASS QQ memory: Mnemon registration, tools, peer isolation, write gate, evidence validation, automatic extraction and replay guard')
}finally{await rm(root,{recursive:true,force:true})}
