import { z } from 'zod';
export function adminDashboard({app,db,auth,admin}) {
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  app.post('/api/activity/visit',auth,async(req,res)=>{
    await db.prepare(`INSERT INTO user_visits(user_id,day,last_seen) VALUES (?,date('now'),?) ON CONFLICT(user_id,day) DO UPDATE SET last_seen=excluded.last_seen WHERE excluded.last_seen-user_visits.last_seen>=60000`).run(req.user.id,Date.now());
    res.json({ok:true});
  });
  app.get('/api/admin/dashboard',auth,admin,async(req,res)=>{
    const {page,q,section}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),q:z.string().trim().max(100).default(''),section:z.enum(['users','listings','activity']).default('users')}).parse(req.query);
    const term=`%${q.replace(/[\\%_]/g,'\\$&')}%`;
    const scope=req.user.university;
    const summary=await get(`SELECT
      (SELECT count(*) FROM users WHERE university=?) users,
      (SELECT count(*) FROM product_subscriptions p JOIN users u ON u.id=p.user_id WHERE u.university=? AND p.enabled=1) productSubscribers,
      (SELECT count(DISTINCT s.user_id) FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.university=? AND u.status='active' AND s.expires_at>?) signedIn,
      (SELECT count(DISTINCT v.user_id) FROM user_visits v JOIN users u ON u.id=v.user_id WHERE u.university=? AND v.day=date('now')) activeToday,
      (SELECT count(DISTINCT v.user_id) FROM user_visits v JOIN users u ON u.id=v.user_id WHERE u.university=? AND v.last_seen>=?) online,
      (SELECT count(*) FROM listings WHERE university=? AND is_demo=0 AND status='active') activeListings,
      (SELECT count(*) FROM listings WHERE university=? AND is_demo=0 AND status='sold') sold,
      (SELECT count(*) FROM listings WHERE university=? AND is_demo=0 AND status='deleted') deleted`,scope,scope,scope,Date.now(),scope,scope,Date.now()-300000,scope,scope,scope);
    const daily=await all(`WITH RECURSIVE days(day) AS (SELECT date('now','-13 days') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<date('now')) SELECT days.day,count(DISTINCT u.id) users FROM days LEFT JOIN user_visits v ON v.day=days.day LEFT JOIN users u ON u.id=v.user_id AND u.university=? GROUP BY days.day ORDER BY days.day`,scope);
    let base,select,order;
    if(section==='users'){
      base=`FROM users u WHERE u.university=? AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')`;
      select=`u.id,u.name,u.email,u.status,u.created_at,EXISTS(SELECT 1 FROM sessions WHERE user_id=u.id AND expires_at>unixepoch('now')*1000) signed_in,(SELECT max(last_seen) FROM user_visits WHERE user_id=u.id) last_seen,(SELECT count(*) FROM listings WHERE seller_id=u.id AND is_demo=0) listings,(SELECT count(*) FROM listings WHERE seller_id=u.id AND is_demo=0 AND status='sold') sold`;
      order='u.created_at DESC,u.id';
    }else if(section==='listings'){
      base=`FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.university=? AND l.is_demo=0 AND (l.title LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')`;
      select='l.id,l.title,l.status,l.price,l.created_at,l.updated_at,u.name,u.email';order='l.updated_at DESC,l.id';
    }else{
      base=`FROM platform_activity a JOIN users u ON u.id=a.user_id WHERE u.university=? AND (u.email LIKE ? ESCAPE '\\' OR a.title LIKE ? ESCAPE '\\')`;
      select='a.id,a.action,a.title,a.created_at,u.name,u.email';order='a.id DESC';
    }
    const total=(await get(`SELECT count(*) total ${base}`,scope,term,term)).total;
    const items=await all(`SELECT ${select} ${base} ORDER BY ${order} LIMIT 25 OFFSET ?`,scope,term,term,(page-1)*25);
    const trackingSince=(await get("SELECT value FROM platform_metadata WHERE key='tracking_since'")).value;
    res.json({summary,daily,items,total,page,trackingSince});
  });
}
