import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createProductUpdates} from '../src/product-updates.js';
import {createApp} from '../src/app.js';
const DAY=86400000;
async function setup(t,count=31){
 const db=await openDatabase(':memory:');t.after(()=>db.close());let clock=Date.parse('2026-09-20T05:00:00Z');const sent=[];const ids=[];
 for(let i=0;i<count+1;i++){const id=randomUUID();ids.push(id);await db.prepare('INSERT INTO users(id,email,name,university,verified_at) VALUES (?,?,?,?,?)').run(id,`u${i}@nst.rishihood.edu.in`,`Student ${i}`,'Campus',new Date(clock).toISOString());if(i<count)await db.prepare('INSERT INTO product_subscriptions(user_id,enabled,unsubscribe_token,opted_at) VALUES (?,1,?,?)').run(id,randomUUID().replaceAll('-','').repeat(2),clock+i);}
 const listing=async()=>{const id=randomUUID();await db.prepare("INSERT INTO listings(id,seller_id,university,title,description,category,price,condition,location,created_at) VALUES (?,?,'Campus','Lamp <new>','Desk lamp','other',10000,'Good','Campus',?)").run(id,ids[count],new Date(clock-1).toISOString());return id;};await listing();
 const mailer={send:async(payload,id)=>sent.push({payload,id})};const make=()=>createProductUpdates({db,origin:'https://example.com',mailer,now:()=>clock});
 return {db,ids,sent,make,listing,advance:n=>clock+=n,now:()=>clock};
}
test('daily rotation caps batches at 30 across workers and requires 72 hours plus new inventory',async t=>{
 const f=await setup(t);const a=f.make(),b=f.make();await Promise.all([a.schedule(),b.schedule()]);assert.equal((await f.db.prepare('SELECT count(*) n FROM product_email_jobs').get()).n,30);
 await Promise.all([a.drain(),b.drain()]);assert.equal(f.sent.length,30);assert.equal(new Set(f.sent.map(x=>x.id)).size,30);assert.match(f.sent[0].payload.htmlContent,/&lt;new&gt;/);
 await a.drain();assert.equal(f.sent.length,30);
 f.advance(DAY);await a.drain();assert.equal(f.sent.length,31);assert.equal(new Set(f.sent.map(x=>x.payload.to[0].email)).size,31);
 f.advance(DAY);await f.listing();await a.drain();assert.equal(f.sent.length,31);
 f.advance(DAY);await a.drain();assert.equal(f.sent.length,61);
 await a.drain();assert.equal(f.sent.length,61);
});
test('unsubscribed users and removed inventory are skipped after reservation; successful campaigns do not repeat old inventory',async t=>{
 const f=await setup(t,2);const a=f.make();await a.schedule();await f.db.prepare('UPDATE product_subscriptions SET enabled=0 WHERE user_id=?').run(f.ids[0]);await a.drain();assert.equal(f.sent.length,1);
 f.advance(4*DAY);await a.drain();assert.equal(f.sent.length,1);
 await f.listing();await a.schedule();await f.db.prepare("UPDATE listings SET status='deleted'").run();await a.drain();assert.equal(f.sent.length,1);
});
test('product updates require explicit consent and unsubscribe works without logging in',async t=>{
 const f=await setup(t,0);const token='session-test';await f.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),f.ids[0],Date.now()+60000);
 const {app}=await createApp({db:f.db,seed:false,devAuth:true,notificationMailer:{send:async()=>{}}});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const request=async(path,method='GET',body,cookie=token)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'X-Requested-With':'HostelOLX','Content-Type':'application/json',cookie:`session=${cookie}`},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 assert.equal((await request('/me/product-updates')).body.enabled,false);assert.equal((await request('/me/product-updates','PATCH',{enabled:true},'')).status,401);
 await request('/me/product-updates','PATCH',{enabled:true});const sub=await f.db.prepare('SELECT * FROM product_subscriptions WHERE user_id=?').get(f.ids[0]);assert.equal(sub.enabled,1);
 assert.equal((await request('/product-updates/unsubscribe','POST',{token:sub.unsubscribe_token},'')).status,200);assert.equal((await request('/me/product-updates')).body.enabled,false);
 assert.equal((await request('/product-updates/unsubscribe','POST',{token:'invalid'},'')).status,422);
});

test('carryover jobs cannot cause more than 30 recipients to be emailed in one day',async t=>{
 const f=await setup(t,61);const a=f.make();await a.schedule();f.advance(DAY-1);await a.schedule(); // Next India day, but original jobs still within 24h.
 await a.drain();await a.drain();assert.equal(f.sent.length,30);
});
