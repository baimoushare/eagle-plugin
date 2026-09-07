const fs = require('fs');
const path = require('path');
const { Level } = require('./node_modules/level');

// 仅修复现有 Tampermonkey 记录的登记信息，不改动 Eagle 数据。
// 执行前由脚本复制数据库文件并保存相关记录，失败时可用备份回滚。
const workspace = path.resolve(__dirname, '..');
const dbPath = path.join(
  process.env.LOCALAPPDATA,
  'Microsoft', 'Edge', 'User Data', 'Default',
  'Local Extension Settings', 'iikmkjmpaadaobahmlepeloendndfphd'
);
const backupRoot = path.join(workspace, '_tm_backup');
const records = [
  { id: 'bc3ffafb-633c-4f2c-983c-3225536e5d00', sourcePath: path.join(workspace, 'eagle-web-collector.user.js') },
  { id: 'ed55ac22-9548-41e6-b307-f04805a34b6f', sourcePath: path.join(workspace, 'eagle-x-collector.user.js') }
];

function parseHeader(source) {
  const headerMatch = source.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  if (!headerMatch) throw new Error('本地脚本缺少 UserScript 头部');
  const header = headerMatch[0];
  const out = { header, names: {}, descriptions: {}, matches: [], grants: [], connects: [] };
  for (const line of header.split(/\r?\n/)) {
    let m = line.match(/^\/\/\s*@name:([^\s]+)\s+(.*)$/);
    if (m) { out.names[m[1]] = m[2].trim(); continue; }
    m = line.match(/^\/\/\s*@description:([^\s]+)\s+(.*)$/);
    if (m) { out.descriptions[m[1]] = m[2].trim(); continue; }
    m = line.match(/^\/\/\s*@([\w-]+)\s+(.*)$/);
    if (!m) continue;
    const key = m[1]; const value = m[2].trim();
    if (key === 'name') out.name = value;
    else if (key === 'description') out.description = value;
    else if (key === 'version') out.version = value;
    else if (key === 'namespace') out.namespace = value;
    else if (key === 'author') out.author = value;
    else if (key === 'icon') out.icon = value;
    else if (key === 'match') out.matches.push(value);
    else if (key === 'grant') out.grants.push(value);
    else if (key === 'connect') out.connects.push(value);
  }
  return out;
}

function updateMeta(metaRaw, source, position) {
  const meta = JSON.parse(metaRaw);
  const h = parseHeader(source);
  const value = meta.value || {};
  value.header = h.header;
  value.name = h.name || value.name;
  value.name_i18n = { ...(value.name_i18n || {}), ...h.names };
  value.description = h.description || value.description;
  value.description_i18n = { ...(value.description_i18n || {}), ...h.descriptions };
  value.version = h.version || value.version;
  value.namespace = h.namespace || value.namespace;
  value.author = h.author || value.author;
  value.matches = h.matches;
  value.grant = h.grants;
  value.connects = h.connects;
  value.icon = h.icon || value.icon || '';
  value.enabled = true;
  value.position = position;
  delete value.deleted;
  value.lastModified = Date.now();
  meta.value = value;
  meta.modified = Date.now();
  meta.lastModified = Date.now();
  return meta;
}

(async () => {
  if (!process.env.LOCALAPPDATA) throw new Error('缺少 LOCALAPPDATA');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupRoot, 'tm-registration-repair-' + stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const file of fs.readdirSync(dbPath)) fs.copyFileSync(path.join(dbPath, file), path.join(backupDir, file));

  const db = new Level(dbPath, { valueEncoding: 'utf8' });
  await db.open();
  try {
    const result = [];
    for (const [index, item] of records.entries()) {
      const sourceKey = '!extdb.@source#' + item.id;
      const metaKey = '!extdb.@meta#' + item.id;
      const uidKey = '!extdb.@uid#' + item.id;
      const source = fs.readFileSync(item.sourcePath, 'utf8');
      const oldSource = await db.get(sourceKey);
      const oldMeta = await db.get(metaKey);
      fs.writeFileSync(path.join(backupDir, item.id + '.source.json'), oldSource, 'utf8');
      fs.writeFileSync(path.join(backupDir, item.id + '.meta.json'), oldMeta, 'utf8');
      const meta = updateMeta(oldMeta, source, index + 2);
      await db.put(sourceKey, JSON.stringify({ ...JSON.parse(oldSource), value: source }));
      await db.put(metaKey, JSON.stringify(meta));
      await db.put(uidKey, JSON.stringify({ origin: 'normal', value: meta.value.name }));
      result.push({ id: item.id, name: meta.value.name, version: meta.value.version, enabled: meta.value.enabled, deleted: Boolean(meta.value.deleted), backupDir });
    }
    console.log(JSON.stringify({ ok: true, result }, null, 2));
  } finally { await db.close(); }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
