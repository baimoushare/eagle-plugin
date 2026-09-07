const path = require('path');
const { Level } = require('level');
const dbPath = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Local Extension Settings', 'iikmkjmpaadaobahmlepeloendndfphd');
(async()=>{
 const db=new Level(dbPath,{valueEncoding:'utf8'}); await db.open();
 try{
  const hits=[];
  for await (const [key,value] of db.iterator()){
   if (typeof key==='string' && key.includes('@source#')){
    let code='';
    try{ const o=JSON.parse(value); code=String(o.value||''); }catch(e){ code=String(value||''); }
    if (code.includes('Eagle 网页采集') || code.includes('Eagle 多网站图片批量抓取') || code.includes('Eagle 批量采集') || code.includes('eagle-web-collector') || code.includes('eagle-site-scraper') || code.includes('e-hentai.org') && code.includes('fab.com')) {
      hits.push({key, len:code.length, head:code.slice(0,300)});
    }
   }
  }
  console.log(JSON.stringify(hits,null,2));
 } finally { await db.close(); }
})().catch(e=>{console.error(e.stack||e); process.exit(1);});
