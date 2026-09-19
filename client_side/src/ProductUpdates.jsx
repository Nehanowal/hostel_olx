import {useEffect,useState} from 'react';
import {api} from './api';
export function ProductUpdatePreference({notify}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let current=true;api('/me/product-updates').then(value=>{if(current)setData(value);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[]);
 if(error)return <p className="error">Product update settings: {error}</p>;
 if(!data?.available)return null;
 return <label className="email-preference"><input type="checkbox" checked={data.enabled} disabled={busy} onChange={async e=>{const enabled=e.target.checked;setBusy(true);try{await api('/me/product-updates',{method:'PATCH',body:{enabled}});setData({...data,enabled});notify(enabled?'Product updates enabled':'Product updates turned off');}catch(e){notify(e.message);}finally{setBusy(false);}}}/><span><strong>Email me about new campus finds</strong><small>Optional product updates when new listings arrive. We rotate through 30 people a day, with at least 3 days between your emails. Unsubscribe anytime.</small></span></label>;
}
export function ProductUnsubscribe({token}){
 const [done,setDone]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <main style={{maxWidth:540,margin:'80px auto',padding:32,background:'white',borderRadius:20}}><div className="eyebrow">FINAL PRICE?</div><h1>{done?'You’re unsubscribed.':'Stop product updates?'}</h1><p>{done?'You won’t receive new-product emails. Your message notification preference stays the same.':'Confirm below to stop new-product emails. You don’t need to sign in.'}</p>{error&&<p className="error" role="alert">{error}</p>}{!done&&<button className="primary" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/product-updates/unsubscribe',{method:'POST',body:{token}});setDone(true);}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'Saving…':'Unsubscribe from product updates'}</button>}<p><a href="/">Return to Final Price?</a></p></main>;
}
