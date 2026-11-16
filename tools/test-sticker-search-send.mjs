// Isolated test: temporary HOME_DIR via copied modules; never writes live configuration/library.
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,copyFile,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
const root=await mkdtemp(join(tmpdir(),'qbe-search-'))
await mkdir(join(root,'lib'),{recursive:true}); await mkdir(join(root,'features','host'),{recursive:true})
await writeFile(join(root,'package.json'),'{"type":"module"}')
for(const file of ['sticker-store.js','sticker-cooldown.js','vision-stream.js']) await copyFile(new URL('../dsh-qqbot-ext/lib/'+file,import.meta.url),join(root,'lib',file))
const configSource=await readFile(new URL('../dsh-qqbot-ext/lib/config.js',import.meta.url),'utf8')
await writeFile(join(root,'lib','config.js'),configSource.replace("join(homedir(), '.dsh-qqbot-ext')",JSON.stringify(join(root,'state'))))
await copyFile(new URL('../dsh-qqbot-ext/features/host/_sticker-index.js',import.meta.url),join(root,'features','host','_sticker-index.js'))
const config=await import(pathToFileURL(join(root,'lib','config.js')))
const store=await import(pathToFileURL(join(root,'lib','sticker-store.js')))
const {createSendGuard}=await import(pathToFileURL(join(root,'lib','sticker-cooldown.js')))
const {createIndexer}=await import(pathToFileURL(join(root,'features','host','_sticker-index.js')))
let count=0
const check=(name,fn)=>Promise.resolve().then(fn).then(()=>{count++; console.log('PASS '+name)})
const library=join(root,'images'); await mkdir(library)
const filename='a'.repeat(40)+'.png', other='b'.repeat(40)+'.png'
const png=Buffer.from('89504e470d0a1a0a'+'00'.repeat(30),'hex')
await writeFile(join(library,filename),png); await writeFile(join(library,other),png)
let live={...config.CONFIG_DEFAULTS,libraryDir:library}
const getConfig=async()=>live
const meta={text:'你再骂',description:'猫举爪，不服',emotions:['炸毛','不服'],scenes:['被调侃后玩笑回怼'],avoid:['认真倾诉'],confidence:0.8}
await check('config zero cooldown and validation',()=>{
 assert.equal(config.normalizeConfig({sameStickerCooldownSeconds:0}).sameStickerCooldownSeconds,0)
 assert.throws(()=>config.normalizeConfig({sameStickerCooldownSeconds:-1}))
 assert.throws(()=>config.assertWritable({...live,indexEnabled:true}))
})
await check('Chinese search and no irrelevant fallback',()=>{
 assert.equal(store.rankStickers([{filename,...meta}],'炸毛 回怼')[0].filename,filename)
 assert.equal(store.rankStickers([{filename,...meta}],'下雨带伞').length,0)
})
let clock=1000000, sends=0
const guard=createSendGuard({now:()=>clock})
const deliver=async()=>{sends++;return {message:{id:'id-'+sends}}}
const send=(key,file=filename,fn=deliver)=>guard.send({library,key,filename:file,getConfig,deliver:fn})
await check('success records cooldown',async()=>{await send('one');assert.equal((await guard.availability(library,'one',filename,live)).cooldownSeconds,600)})
await check('same image blocked; session isolated',async()=>{await assert.rejects(send('one'),/冷却/);await send('two')})
await check('burst interval blocks different image',()=>assert.rejects(send('one',other),/冷却/))
await check('failure does not record',async()=>{await assert.rejects(send('failure',filename,async()=>{throw Error('QQ failed')}));assert.equal((await guard.availability(library,'failure',filename,live)).cooldownSeconds,0)})
await check('missing receipt not success',()=>assert.rejects(send('missing',filename,async()=>({})),/消息 ID/))
await check('live config can disable cooldown',async()=>{live={...live,sameStickerCooldownSeconds:0,stickerSendIntervalSeconds:0};await send('one')})
await check('concurrent duplicate serialized',async()=>{live={...live,sameStickerCooldownSeconds:600};const results=await Promise.allSettled([send('race'),send('race')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1)})
await check('restart preserves usage',async()=>{const next=createSendGuard({now:()=>clock});assert.equal((await next.availability(library,'race',filename,live)).cooldownSeconds,600)})
await check('expired cooldown passes',async()=>{clock+=601000;await send('one')})
await check('invalid path and missing file denied',async()=>{await assert.rejects(send('x','../file.png'));await assert.rejects(send('x','c'.repeat(40)+'.png'))})
let calls=0, fail=false
const ctx={get(name){if(name==='attachments') return {saveImage:async()=>({id:'ref'})};return {async *stream(){calls++;if(fail)throw Error('vision failure');yield {type:'reasoning-delta',index:0,text:'Need JSON. Think carefully.'};yield {type:'text-delta',index:1,text:JSON.stringify(meta)};yield {type:'block-end',index:1,block:{type:'text',text:JSON.stringify(meta)}};yield {type:'finish',reason:{kind:'stop'}}}}}}
const indexer=createIndexer({ctx,getConfig,logger:{warn(){}}})
await check('index disabled makes zero calls',async()=>{await indexer.runOnce();assert.equal(calls,0)})
live={...live,indexEnabled:true,indexProvider:'test',indexModel:'vision'}
await check('old images backfilled once',async()=>{await indexer.runOnce();assert.equal(calls,2);await indexer.runOnce();assert.equal(calls,2);assert.equal((await indexer.list()).filter(x=>x.indexed).length,2)})
await check('manual correction survives retry',async()=>{await indexer.update(filename,{...meta,description:'人工'});await assert.rejects(indexer.retry(filename),/人工/);assert.equal((await indexer.list())[0].description,'人工')})
await check('vision failure keeps image unindexed',async()=>{await indexer.retry(other);fail=true;await indexer.runOnce();assert.equal((await indexer.list()).find(x=>x.filename===other).indexed,false);assert.equal((await readFile(join(library,other))).length,png.length)})
indexer.stop()
await check('attachment timeout releases runner',async()=>{
 const hanging=createIndexer({ctx:{get(name){return name==='attachments' ? {saveImage:()=>new Promise(()=>{})} : {stream(){throw Error('not reached')}}}},getConfig:async()=>({...live,indexTimeoutMs:20}),logger:{warn(){}}})
 await hanging.runOnce(); assert.equal(hanging.status.running,false);assert.match(hanging.status.lastError,/超时/);hanging.stop()
})
const {collectVisionText}=await import(pathToFileURL(join(root,'lib','vision-stream.js')))
const streamOf=async function*(chunks){yield* chunks}
await check('reasoning never becomes answer; authoritative block is not duplicated',async()=>{
 assert.equal(await collectVisionText(streamOf([{type:'reasoning-delta',index:0,text:'Need JSON'},{type:'text-delta',index:1,text:'partial'},{type:'block-end',index:1,block:{type:'text',text:'final'}}])), 'final')
})
await check('reasoning-only output reports missing final answer',()=>assert.rejects(collectVisionText(streamOf([{type:'reasoning-delta',index:0,text:'Need JSON'}])),/最终正文/))
await check('token truncation and provider errors fail visibly',async()=>{
 await assert.rejects(collectVisionText(streamOf([{type:'finish',reason:{kind:'max-tokens'}}])),/token/)
 await assert.rejects(collectVisionText(streamOf([{type:'finish',reason:{kind:'error',failure:{message:'provider failed'}}}])),/provider failed/)
})
console.log(`${count} isolated checks passed; fixtures: ${root}`)
