import {z} from 'zod';
import {categories} from './catalog.js';
export function guestRoutes({app,db,university,imageStorage}){
 const visible="l.university=? AND l.status='active' AND l.is_demo=0 AND u.status='active'";
 app.get('/api/guest/listings',async(req,res)=>{
  const {page,q,category,sort}=z.object({sort:z.enum(['recommended','popular','newest','price-low','price-high']).default('recommended'),page:z.coerce.number().int().min(1).max(10000).default(1),q:z.string().trim().max(100).default(''),category:z.enum(categories.map(c=>c.id)).optional()}).parse(req.query);
  const args=[university];let where=visible;
  if(q){where+=" AND l.title LIKE ? ESCAPE '\\'";args.push(`%${q.replace(/[\\%_]/g,'\\$&')}%`);}
  if(category){where+=' AND l.category=?';args.push(category);}
  const base=`FROM listings l JOIN users u ON u.id=l.seller_id WHERE ${where}`;
  const total=(await db.prepare(`SELECT count(*) total ${base}`).get(...args)).total;
  // Public projection deliberately excludes identities, descriptions, locations and attributes.
  const order={recommended:"CASE WHEN l.category='Fashion' THEN 1 ELSE 0 END,CASE WHEN l.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-48 hours') THEN 0 ELSE 1 END,CASE WHEN l.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-48 hours') THEN l.created_at END DESC,l.opens DESC,l.created_at DESC,l.id DESC",popular:'l.opens DESC,l.created_at DESC,l.id DESC',newest:'l.created_at DESC,l.id DESC','price-low':'l.price ASC,l.id DESC','price-high':'l.price DESC,l.id DESC'}[sort];
  const rows=await db.prepare(`SELECT l.id,l.title,l.category,l.condition,l.price,l.created_at ${base} ORDER BY ${order} LIMIT 24 OFFSET ?`).all(...args,(page-1)*24);
  const items=await Promise.all(rows.map(async row=>({...row,images:(await db.prepare('SELECT id FROM images WHERE listing_id=? ORDER BY position,id LIMIT 6').all(row.id)).map(image=>({url:`/api/guest/images/${image.id}`}))})));
  res.json({items,total,page,hasMore:page*24<total,university,categories:categories.map(c=>c.id)});
 });
 app.get('/api/guest/images/:id',async(req,res)=>{
  const id=z.uuid().parse(req.params.id);
  const image=await db.prepare(`SELECT i.path FROM images i JOIN listings l ON l.id=i.listing_id JOIN users u ON u.id=l.seller_id WHERE i.id=? AND ${visible}`).get(id,university);
  if(!image)return res.status(404).json({error:'Photo not available.'});
  return imageStorage.send(image.path,res);
 });
}
