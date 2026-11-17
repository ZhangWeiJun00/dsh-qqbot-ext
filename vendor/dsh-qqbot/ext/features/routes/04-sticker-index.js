function reply(res,status,body) {
  const text=JSON.stringify(body)
  if (res?.writeHead) {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(text); return}
  return new Response(text,{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
}
async function bodyOf(req) {
  if (typeof req?.[Symbol.asyncIterator] === 'function') {
    let size=0; const chunks=[]
    for await(const chunk of req) {size+=chunk.length; if(size>131072) throw new Error('请求体过大'); chunks.push(chunk)}
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  }
  const text=await req.text()
  if (Buffer.byteLength(text)>131072) throw new Error('请求体过大')
  return JSON.parse(text || '{}')
}
export function register(ctx) {
  ctx.webServer.register({kind:'exact',path:'/qqbot-ext/sticker-index',async handler(req,res) {
    try {
      const method=String(req.method || 'GET').toUpperCase()
      if (!['GET','POST'].includes(method)) return reply(res,405,{ok:false,error:'只支持 GET / POST'})
      const origin=req.headers?.origin
      if(origin !== undefined && new URL(origin).host !== req.headers.host) return reply(res,403,{ok:false,error:'来源不可信'})
      const service=ctx.get('qqbotExtStickerIndex')
      if(!service) return reply(res,503,{ok:false,error:'图片索引服务尚未就绪'})
      if(method==='GET') return reply(res,200,{ok:true,items:await service.list(),status:service.status})
      const body=await bodyOf(req)
      if(body.action==='update') await service.update(body.filename,body.metadata)
      else if(body.action==='retry') await service.retry(body.filename)
      else if(body.action==='run') service.schedule()
      else return reply(res,400,{ok:false,error:'未知操作'})
      return reply(res,200,{ok:true,status:service.status})
    } catch(error) {return reply(res,400,{ok:false,error:String(error.message || error)})}
  }})
}
