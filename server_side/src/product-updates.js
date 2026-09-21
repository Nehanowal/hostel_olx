import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
const DAY=86400000;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createProductUpdates({db,mailer,origin,now=Date.now,logger=console}){
 const run=(sql,...args)=>db.prepare(sql).run(...args),get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args);
 let timer,running=false;
 const listings=(user,cutoff)=>all(`SELECT l.id,l.title,l.price FROM listings l JOIN users s ON s.id=l.seller_id WHERE l.university=? AND l.seller_id<>? AND l.is_demo=0 AND l.status='active' AND s.status='active' AND l.created_at>? AND l.created_at<=? ORDER BY l.created_at DESC,l.id LIMIT 6`,user.university,user.user_id,new Date(Math.max(user.last_cutoff||0,cutoff-14*DAY)).toISOString(),new Date(cutoff).toISOString());
 async function schedule(){
  if(!mailer)return;
  const time=now(),local=new Date(time+330*60000),day=local.toISOString().slice(0,10);
  if(local.getUTCHours()<9)return;
  await db.transaction(async()=>{
   if(await get('SELECT 1 FROM product_batches WHERE day=?',day))return;
   const candidates=await all(`SELECT p.*,u.university FROM product_subscriptions p JOIN users u ON u.id=p.user_id WHERE p.enabled=1 AND u.status='active' AND max(coalesce(p.last_attempt,0),coalesce(p.last_sent,0))<=? AND max(coalesce((SELECT max(last_seen) FROM user_visits WHERE user_id=u.id),0),coalesce(unixepoch(u.verified_at)*1000,0))>=? AND NOT EXISTS(SELECT 1 FROM product_email_jobs j WHERE j.user_id=u.id AND j.status IN ('pending','sending')) ORDER BY coalesce(p.last_attempt,0),p.opted_at,p.user_id`,time-3*DAY,time-30*DAY);
   const selected=[];
   for(const user of candidates){if((await listings(user,time)).length)selected.push(user);if(selected.length===30)break;}
   if(!selected.length)return;
   await run('INSERT INTO product_batches(day,created_at) VALUES (?,?)',day,time);
   for(const user of selected){await run('INSERT INTO product_email_jobs(id,user_id,day,cutoff,due_at) VALUES (?,?,?,?,?)',randomUUID(),user.user_id,day,time,time);await run('UPDATE product_subscriptions SET last_attempt=? WHERE user_id=?',time,user.user_id);}
  });
 }
 async function claim(){return db.transaction(async()=>{
  const time=now();await run("UPDATE product_email_jobs SET status='pending' WHERE status='sending' AND lease_until<=?",time);
  const job=await get("SELECT * FROM product_email_jobs WHERE status='pending' AND due_at<=? ORDER BY due_at,id LIMIT 1",time);if(!job)return null;
  const user=await get('SELECT p.*,u.name,u.email,u.university,u.status FROM product_subscriptions p JOIN users u ON u.id=p.user_id WHERE p.user_id=?',job.user_id);
  if(!user?.enabled||user.status!=='active'||time-job.cutoff>DAY||(job.first_attempt!==null&&time-job.first_attempt>=25*60000)){
   await run("UPDATE product_email_jobs SET status='skipped',payload=NULL WHERE id=?",job.id);return {skip:true};
  }
  let payload=job.payload;
  if(!payload){
   const items=await listings(user,job.cutoff);if(!items.length){await run("UPDATE product_email_jobs SET status='skipped' WHERE id=?",job.id);return {skip:true};}
   const unsubscribe=`${origin}/?unsubscribeUpdates=${user.unsubscribe_token}`;
   const lines=items.map(item=>`${item.title} — ₹${Math.round(item.price/100)}`);
   payload=JSON.stringify({to:[{email:user.email,name:user.name}],subject:'New finds on your campus — Final Price?',textContent:`Hi ${user.name},\n\nTake a look at these recently listed campus finds:\n${lines.join('\n')}\n\nExplore: ${origin}\n\nYou opted into product updates. Unsubscribe: ${unsubscribe}`,htmlContent:`<html><body style="background:#f3f5f9;font-family:Arial,sans-serif;color:#18203d"><main style="max-width:520px;margin:32px auto;padding:32px;background:white;border-radius:16px"><h1>New finds on campus.</h1><p>Hi ${escape(user.name)}, here are some recent listings on Final Price?</p><ul>${lines.map(line=>`<li style="padding:10px 0">${escape(line)}</li>`).join('')}</ul><p><a href="${origin}" style="display:inline-block;padding:14px 20px;background:#284df3;color:white;border-radius:8px">Explore Final Price?</a></p><p style="font-size:12px">You opted into product updates. <a href="${unsubscribe}">Unsubscribe from product updates</a></p></main></body></html>`});
  }
  // Count actual send attempts by recipient/day too, including jobs carried over from yesterday.
  const sendDay=new Date(time+330*60000).toISOString().slice(0,10);
  if(!await get('SELECT 1 FROM product_send_slots WHERE day=? AND user_id=?',sendDay,job.user_id)){
   if((await get('SELECT count(*) n FROM product_send_slots WHERE day=?',sendDay)).n>=30){
    const tomorrow=(Math.floor((time+330*60000)/DAY)+1)*DAY-330*60000+9*3600000;
    await run('UPDATE product_email_jobs SET due_at=? WHERE id=?',tomorrow,job.id);return {skip:true};
   }
   await run('INSERT INTO product_send_slots(day,user_id) VALUES (?,?)',sendDay,job.user_id);
  }
  await run("UPDATE product_email_jobs SET status='sending',lease_until=?,first_attempt=coalesce(first_attempt,?),attempts=attempts+1,payload=? WHERE id=?",time+60000,time,payload,job.id);
  return {...job,payload:JSON.parse(payload)};
 });}
 async function drain({limit=30}={}){if(!mailer||running)return;running=true;try{
  await schedule();
  for(let i=0;i<limit;i++){
   const job=await claim();if(!job)break;if(job.skip)continue;
   try{await mailer.send(job.payload,job.id);await db.transaction(async()=>{await run("UPDATE product_email_jobs SET status='sent',payload=NULL WHERE id=?",job.id);await run('UPDATE product_subscriptions SET last_sent=?,last_cutoff=? WHERE user_id=?',now(),job.cutoff,job.user_id);});}
   catch(error){const retry=error.retryable!==false&&job.attempts<4;await run("UPDATE product_email_jobs SET status=?,due_at=?,payload=CASE WHEN ? THEN payload ELSE NULL END WHERE id=?",retry?'pending':'failed',now()+60000*2**job.attempts,retry?1:0,job.id);logger.warn('Product update delivery deferred',{jobId:job.id,retry});}
  }
  await run('DELETE FROM product_send_slots WHERE day<?',new Date(now()-30*DAY).toISOString().slice(0,10));
  await run("DELETE FROM product_email_jobs WHERE status IN ('sent','failed','skipped') AND cutoff<?",now()-30*DAY);
 }finally{running=false;}}
 return {enabled:!!mailer,schedule,drain,start(){if(timer||!mailer)return;const tick=()=>drain().catch(()=>logger.warn('Product update worker unavailable'));timer=setInterval(tick,60000);timer.unref();tick();},stop(){clearInterval(timer);timer=undefined;}};
}
export function productUpdateRoutes({app,db,auth,updates}){
 app.get('/api/me/product-updates',auth,async(req,res)=>{const row=await db.prepare('SELECT enabled FROM product_subscriptions WHERE user_id=?').get(req.user.id);res.json({enabled:!!row?.enabled,available:updates.enabled});});
 app.patch('/api/me/product-updates',auth,async(req,res)=>{
  const {enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body);
  await db.prepare(`INSERT INTO product_subscriptions(user_id,enabled,unsubscribe_token,opted_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,opted_at=CASE WHEN product_subscriptions.enabled=0 AND excluded.enabled=1 THEN excluded.opted_at ELSE product_subscriptions.opted_at END`).run(req.user.id,enabled?1:0,randomBytes(32).toString('hex'),Date.now());res.json({enabled});
 });
 app.post('/api/product-updates/unsubscribe',async(req,res)=>{
  const {token}=z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
  await db.prepare('UPDATE product_subscriptions SET enabled=0 WHERE unsubscribe_token=?').run(token);res.json({ok:true});
 });
}
