import http from 'node:http';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const user = process.env.ACCESS_USER;
const password = process.env.ACCESS_PASSWORD;
const secret = process.env.SESSION_SECRET;
if (!user || !password || password.length < 16 || !secret || secret.length < 32) throw new Error('Access credentials are required');
const origin = new URL(process.env.SITE_URL);
if (origin.protocol !== 'https:') throw new Error('SITE_URL must use HTTPS');
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
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>登录 · WorkBuddy做大做强</title><style>
:root{color-scheme:light;--paper:#f6f3ec;--surface:#fcfaf6;--ink:#302d28;--muted:#6b6257;--line:#ded7cc;--clay:#8d4c37;--hover:#7a3e2c;--button-ink:#fffaf3;--field:#f0ece3;--error:#a43e30}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--paper:#211f1c;--surface:#292620;--ink:#f0e9df;--muted:#baad9c;--line:#403a31;--clay:#dda087;--hover:#edb69d;--button-ink:#2b201a;--field:#322d26;--error:#e79780}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 "Avenir Next","PingFang SC","Microsoft YaHei",system-ui,sans-serif}main{min-height:100dvh;display:grid;place-items:center;padding:40px 20px}.entry{width:100%;max-width:960px;display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:80px;align-items:center}.intro{padding:20px 0}.brand{display:inline-flex;gap:14px;align-items:center;white-space:nowrap}.mark{height:54px;width:2px;background:var(--clay);flex-shrink:0}.brand-name{display:flex;flex-direction:column;gap:8px;font-size:29px;font-weight:600;line-height:1;letter-spacing:-.035em}.brand-name span{font-family:"Iowan Old Style","Songti SC","Noto Serif CJK SC",Georgia,STSong,serif;font-size:17px;font-weight:400;letter-spacing:.18em;color:var(--muted)}h1{margin:48px 0 20px;font:400 clamp(30px,4vw,44px)/1.4 "Iowan Old Style","Songti SC","Noto Serif CJK SC",Georgia,STSong,serif;letter-spacing:-.02em}.intro p{max-width:350px;margin:0;color:var(--muted);font-size:14px;line-height:1.9}.form-panel{background:var(--surface);border-block:1px solid var(--line);padding:40px 32px}h2{margin:0 0 10px;font:400 27px/1.4 "Songti SC","Noto Serif CJK SC",STSong,serif}.caption{margin:0 0 28px;font-size:13px;color:var(--muted)}label{display:block;margin-top:20px;font-size:13px}input,button{width:100%;font:inherit;border-radius:6px;min-height:48px;padding:11px 14px}input{border:1px solid var(--line);background:var(--field);color:var(--ink);margin-top:8px}input:focus-visible,button:focus-visible{outline:2px solid var(--clay);outline-offset:3px}button{border:0;background:var(--clay);color:var(--button-ink);font-size:14px;font-weight:600;margin-top:28px;cursor:pointer;transition:background .2s}button:hover{background:var(--hover)}[role=alert]{color:var(--error);font-size:13px}footer{border-top:1px solid var(--line);margin:28px 0 0;padding-top:18px;font-size:12px;color:var(--muted)}
@media(max-width:720px){main{padding:32px 20px}.entry{max-width:400px;grid-template-columns:minmax(0,1fr);gap:28px}.intro{padding:0}h1{margin:28px 0 12px;font-size:28px}.intro p{font-size:13px}.brand-name{font-size:26px}.form-panel{padding:28px 24px}}
</style><main><div class="entry"><section class="intro"><div class="brand" role="img" aria-label="WorkBuddy做大做强"><i class="mark" aria-hidden="true"></i><div class="brand-name" aria-hidden="true">WorkBuddy<span>做大做强</span></div></div><h1>看见变化，<br>找到下一步。</h1><p>从行业动态到内容选题与商业机会，<br>一起把 WorkBuddy 业务做扎实。</p></section><section class="form-panel"><h2>团队入口</h2><p class="caption">使用团队账号进入业务雷达。</p><form method="post" action="/_auth/login"><label>团队账号<input name="username" autocomplete="username" required></label><label>访问密码<input name="password" type="password" autocomplete="current-password" required></label><button>进入工作台</button></form><footer>团队内部使用 · 行业动态 / 商业机会 / 每日选题</footer></section></div></main></html>`;
const server = http.createServer((req,res)=>{
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Type','text/plain; charset=utf-8');
  // Only the local tunnel can reach this listener; it supplies the visitor protocol.
  if (String(req.headers['x-forwarded-proto']||'').toLowerCase()==='http') {
    // 303 discards stale HTTP form bodies instead of replaying passwords.
    const path=(req.method==='GET'||req.method==='HEAD') && req.url.startsWith('/') ? req.url : '/';
    res.writeHead(303,{'Location':origin.origin+path});return res.end('请使用 HTTPS 安全连接。');
  }
  res.setHeader('Strict-Transport-Security','max-age=31536000');
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
