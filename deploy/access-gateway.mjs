import http from 'node:http';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const user = process.env.ACCESS_USER;
const password = process.env.ACCESS_PASSWORD;
const secret = process.env.SESSION_SECRET;
if (!user || !password || password.length < 16 || !secret || secret.length < 32) throw new Error('Access credentials are required');
const origin = new URL(process.env.SITE_URL);
const upstream = new URL(process.env.ACCESS_UPSTREAM || 'http://127.0.0.1:3300');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname)) throw new Error('Upstream must be local');
const cookieName = 'radar_access';
const equal = (a,b) => { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); };
const sign = (s) => createHmac('sha256', secret).update(s).digest('base64url');
function valid(req) {
  const value = String(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';
  const parts = value.split('.');
  if (parts.length!==3) return false;
  return /^\d+$/.test(parts[0]) && Number(parts[0])>Date.now() && equal(sign(parts[0]+'.'+parts[1]), parts[2]);
}
const attempts = new Map();
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>登录 · WorkBuddy做大做强</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f3ee;color:#222c2c;font:16px/1.7 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:min(100%,390px)}small{letter-spacing:.18em;color:#536e61}h1{font-size:32px;letter-spacing:-1px;margin:16px 0 8px}p{color:#67736c}label{display:block;margin-top:18px}input,button{width:100%;padding:13px;border:1px solid #cbcfc5;border-radius:6px;font:inherit}input{background:#fff}button{margin-top:24px;background:#204f3d;color:white;cursor:pointer;border:0}footer{margin-top:32px;font-size:13px;color:#7b837e}</style><main><small>WORKBUDDY · GROW TOGETHER</small><h1>WorkBuddy做大做强</h1><p>把行业变化，变成值得行动的机会。</p><form method="post" action="/_auth/login"><label>团队账号<input name="username" autocomplete="username" required></label><label>访问密码<input name="password" type="password" autocomplete="current-password" required></label><button>进入工作台</button></form><footer>团队内部使用 · 行业动态 / 商业机会 / 每日选题</footer></main></html>`;
const server = http.createServer((req,res)=>{
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.url === '/_auth/login' && req.method==='POST') {
    if (req.headers.origin && req.headers.origin!==origin.origin) {res.writeHead(403);return res.end('Forbidden');}
    const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress);
    const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
    if (attempts.size>10000 || (attempts.get(ip)?.count || 0)>=8) {res.writeHead(429,{'Retry-After':'900'});return res.end('尝试次数过多，请稍后再试。');}
    let body='',tooLarge=false;
    req.on('data',chunk=>{body+=chunk;if(body.length>4096){tooLarge=true;res.writeHead(413);res.end();req.destroy();}});
    req.on('end',()=>{
      if(tooLarge)return;
      const fields=new URLSearchParams(body);
      if (!equal(fields.get('username')||'',user) || !equal(fields.get('password')||'',password)) {
        const old=attempts.get(ip);attempts.set(ip,{count:(old?.count||0)+1,until:old?.until||now+900000});
        res.writeHead(401,{'Content-Type':'text/html; charset=utf-8'});return res.end(html.replace('<form','<p role="alert">账号或密码不正确，请重试。</p><form'));
      }
      attempts.delete(ip);
      const value=String(now+7*86400000)+'.'+randomBytes(16).toString('base64url');
      res.writeHead(303,{'Location':'/','Set-Cookie':`${cookieName}=${value}.${sign(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`});return res.end();
    });return;
  }
  if (!valid(req)) {
    if (req.method!=='GET' && req.method!=='HEAD') {res.writeHead(401);return res.end('Authentication required');}
    if (!String(req.headers.accept||'').includes('text/html')) {res.writeHead(401);return res.end('Authentication required');}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});return res.end(html);
  }
  const headers={...req.headers,host:origin.host,'x-forwarded-proto':'https','x-forwarded-host':origin.host,'x-forwarded-for':req.headers['cf-connecting-ip']||req.socket.remoteAddress};
  const proxy=http.request({hostname:upstream.hostname,port:upstream.port,path:req.url,method:req.method,headers,timeout:60000},response=>{
    const safeHeaders={...response.headers,'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow, noarchive'};
    res.writeHead(response.statusCode||502,safeHeaders);response.pipe(res);
  });
  proxy.on('timeout',()=>proxy.destroy());proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('服务暂时不可用，请稍后重试。');});req.pipe(proxy);
});
server.listen(Number(process.env.ACCESS_PORT||3400),'127.0.0.1');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
