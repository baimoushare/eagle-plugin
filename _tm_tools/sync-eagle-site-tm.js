const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Level } = require('level');

// 无论从插件根目录还是 _tm_tools 目录执行，都稳定指向插件根目录。
const workspace = path.resolve(__dirname, '..');
const dbPath = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Local Extension Settings', 'iikmkjmpaadaobahmlepeloendndfphd');
const id = 'bc3ffafb-633c-4f2c-983c-3225536e5d00';
const sourceKey = `!extdb.@source#${id}`;
const metaKey = `!extdb.@meta#${id}`;
const scriptPath = path.join(workspace, 'eagle-web-collector.user.js');
const backupDir = path.join(workspace, '_tm_backup');
fs.mkdirSync(backupDir, { recursive: true });
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();

(async () => {
  const db = new Level(dbPath, { valueEncoding: 'utf8' });
  await db.open();
  try {
    const sourceRaw = await db.get(sourceKey);
    let metaRaw = '';
    try { metaRaw = await db.get(metaKey); } catch (e) { metaRaw = ''; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(backupDir, `tm-eagle-site-source-before-eh-timeout-${stamp}.json`), sourceRaw, 'utf8');
    if (metaRaw) fs.writeFileSync(path.join(backupDir, `tm-eagle-site-meta-before-eh-timeout-${stamp}.json`), metaRaw, 'utf8');

    const newScript = fs.readFileSync(scriptPath, 'utf8');
    const sourceObj = JSON.parse(sourceRaw);
    sourceObj.value = newScript;
    await db.put(sourceKey, JSON.stringify(sourceObj));

    if (metaRaw) {
      const metaObj = JSON.parse(metaRaw);
      const headerMatch = newScript.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
      if (headerMatch) {
        if ('value' in metaObj && typeof metaObj.value === 'string') metaObj.value = headerMatch[0];
        if ('header' in metaObj && typeof metaObj.header === 'string') metaObj.header = headerMatch[0];
        if ('code' in metaObj && typeof metaObj.code === 'string') metaObj.code = headerMatch[0];
        if ('meta' in metaObj && typeof metaObj.meta === 'string') metaObj.meta = headerMatch[0];
        metaObj.modified = Date.now();
        metaObj.lastModified = Date.now();
      }
      await db.put(metaKey, JSON.stringify(metaObj));
    }

    const verifyRaw = await db.get(sourceKey);
    const verifyObj = JSON.parse(verifyRaw);
    const uploadedScript = String(verifyObj.value || '');
    const localSha256 = sha256(newScript);
    const uploadedSha256 = sha256(uploadedScript);
    if (localSha256 !== uploadedSha256) {
      throw new Error(`Tampermonkey source verification failed: local=${localSha256} uploaded=${uploadedSha256}`);
    }
    console.log(JSON.stringify({ ok: true, verified: true, scriptBytes: Buffer.byteLength(newScript), localSha256, uploadedSha256, sourceKey, backupDir }, null, 2));
  } finally {
    await db.close();
  }
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
