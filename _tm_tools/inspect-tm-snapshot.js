const { Level } = require('level');
const path = require('path');

const db = new Level(path.resolve(process.argv[2]), { valueEncoding: 'utf8' });
(async () => {
  await db.open();
  const key = '!extdb.@source#ed55ac22-9548-41e6-b307-f04805a34b6f';
  const raw = await db.get(key);
  const code = String(JSON.parse(raw).value || '');
  const start = code.indexOf('fetchJson: async function (status_id)');
  const end = code.indexOf('getObservedTimelineRequest: function ()', start);
  console.log(JSON.stringify({
    version: code.match(/@version[^\n]*/)?.[0] || '',
    modified: code.match(/@modified[^\n]*/)?.[0] || '',
    bytes: code.length,
    fetchJson: code.slice(start, Math.min(end, start + 9000)),
  }, null, 2));
  await db.close();
})().catch((error) => { console.error(error); process.exit(1); });
