import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('gateway protects every data outlet and rejects forged sessions', async(t)=>{
  const upstream=http.createServer((req,res)=>res.end('private data'));
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const portServer=http.createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');
  const port=portServer.address().port;await new Promise(r=>portServer.close(r));
  const child=spawn(process.execPath,['deploy/access-gateway.mjs'],{env:{...process.env,ACCESS_USER:'team',ACCESS_PASSWORD:'test-password-at-least-16',SESSION_SECRET:'test-secret-more-than-thirty-two-characters',SITE_URL:'https://radar.example.org',ACCESS_UPSTREAM:`http://127.0.0.1:${upstream.address().port}`,ACCESS_PORT:String(port)},stdio:'ignore'});
  t.after(async()=>{child.kill();await new Promise(r=>upstream.close(r));});
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<50;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,20));}}
  for(const path of ['/api/site/radar','/api/v1/items','/feed.xml','/api/mcp','/all'])assert.equal((await fetch(base+path)).status,401,path);
  assert.match(await(await fetch(base,{headers:{accept:'text/html'}})).text(),/WorkBuddy做大做强/);
  const login=await fetch(base+'/_auth/login',{method:'POST',headers:{origin:'https://radar.example.org','content-type':'application/x-www-form-urlencoded'},body:'username=team&password=test-password-at-least-16',redirect:'manual'});
  assert.equal(login.status,303);
  const full=login.headers.get('set-cookie');assert.match(full,/HttpOnly; Secure; SameSite=Lax/);
  const cookie=full.split(';')[0];assert.equal(await(await fetch(base+'/api/site/radar',{headers:{cookie}})).text(),'private data');
  assert.equal((await fetch(base+'/api/site/radar',{headers:{cookie:cookie+'x'}})).status,401);
  assert.equal((await fetch(base+'/_auth/login',{method:'POST',headers:{origin:'https://evil.example'},body:'username=team&password=test-password-at-least-16'})).status,403);
  await t.test('HTTP entry redirects to HTTPS before showing a password form',async()=>{
    const response=await fetch(base+'/opportunities?type=peer',{headers:{accept:'text/html','x-forwarded-proto':'http'},redirect:'manual'});
    assert.equal(response.status,303);
    assert.equal(response.headers.get('location'),'https://radar.example.org/opportunities?type=peer');
    assert.doesNotMatch(await response.text(),/name="password"/);
  });
  await t.test('stale HTTP form returns to HTTPS without replaying credentials',async()=>{
    const response=await fetch(base+'/_auth/login',{method:'POST',headers:{origin:'http://radar.example.org','x-forwarded-proto':'http'},body:'username=team&password=test-password-at-least-16',redirect:'manual'});
    assert.equal(response.status,303);
    assert.equal(response.headers.get('location'),'https://radar.example.org/');
    assert.equal(response.headers.get('set-cookie'),null);
  });
  await t.test('HTTPS errors are typed text, not downloadable login files',async()=>{
    const response=await fetch(base+'/_auth/login',{method:'POST',headers:{origin:'http://radar.example.org','x-forwarded-proto':'https'},body:'username=team&password=test-password-at-least-16',redirect:'manual'});
    assert.equal(response.status,403);
    assert.match(response.headers.get('content-type')||'',/^text\/plain; charset=utf-8$/);
    assert.match(response.headers.get('strict-transport-security')||'',/max-age=/);
  });
});
