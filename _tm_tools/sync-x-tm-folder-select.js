const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Level } = require('level');

// 无论从插件根目录还是 _tm_tools 目录执行，都稳定指向插件根目录。
const workspace = path.resolve(__dirname, '..');
const dbPath = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Local Extension Settings', 'iikmkjmpaadaobahmlepeloendndfphd');
const sourceKey = '!extdb.@source#ed55ac22-9548-41e6-b307-f04805a34b6f';
const metaKey = '!extdb.@meta#ed55ac22-9548-41e6-b307-f04805a34b6f';
const newScriptPath = path.join(workspace, 'eagle-x-collector.user.js');
const backupDir = path.join(workspace, '_tm_backup');
fs.mkdirSync(backupDir, { recursive: true });
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();

(async () => {
  const db = new Level(dbPath, { valueEncoding: 'utf8' });
  await db.open();
  try {
    const sourceRaw = await db.get(sourceKey);
    const metaRaw = await db.get(metaKey);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(backupDir, `tm-x-source-before-folder-select-${stamp}.json`), sourceRaw, 'utf8');
    fs.writeFileSync(path.join(backupDir, `tm-x-meta-before-folder-select-${stamp}.json`), metaRaw, 'utf8');

    const newScript = fs.readFileSync(newScriptPath, 'utf8');
    let sourceObj = JSON.parse(sourceRaw);
    let metaObj = JSON.parse(metaRaw);

    if (!sourceObj || typeof sourceObj !== 'object' || !('value' in sourceObj)) {
      throw new Error('Tampermonkey source record structure is unexpected');
    }
    sourceObj.value = newScript;

    // 同步 meta 里的脚本头，避免 Tampermonkey 编辑器显示旧头部信息。
    const headerMatch = newScript.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
    if (headerMatch && metaObj && typeof metaObj === 'object') {
      if ('value' in metaObj && typeof metaObj.value === 'string') metaObj.value = headerMatch[0];
      if ('header' in metaObj && typeof metaObj.header === 'string') metaObj.header = headerMatch[0];
      if ('code' in metaObj && typeof metaObj.code === 'string') metaObj.code = headerMatch[0];
      if ('meta' in metaObj && typeof metaObj.meta === 'string') metaObj.meta = headerMatch[0];
      metaObj.modified = Date.now();
      metaObj.lastModified = Date.now();
    }

    await db.put(sourceKey, JSON.stringify(sourceObj));
    await db.put(metaKey, JSON.stringify(metaObj));
    const verifyRaw = await db.get(sourceKey);
    const verifyObj = JSON.parse(verifyRaw);
    const uploadedScript = String(verifyObj.value || '');
    const localSha256 = sha256(newScript);
    const uploadedSha256 = sha256(uploadedScript);
    if (localSha256 !== uploadedSha256) {
      throw new Error(`Tampermonkey source verification failed: local=${localSha256} uploaded=${uploadedSha256}`);
    }
    console.log(JSON.stringify({ ok: true, verified: true, dbPath, scriptBytes: Buffer.byteLength(newScript), localSha256, uploadedSha256, backupDir }, null, 2));
  } finally {
    await db.close();
  }
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
