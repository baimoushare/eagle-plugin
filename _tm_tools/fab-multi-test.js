const p = window.__UIPanel;
p.folders = [
  { id: 'f1', name: 'Eagle丨成长', children: [{ id: 'f2', name: '01. 三维CG', children: [] }] },
  { id: 'f3', name: '参考素材', children: [] },
];
p.folderExpandedIds = new Set(['f1']);
const select = p.getFolderSelect();
select.innerHTML = '<option value="">默认</option><option value="f1">Eagle丨成长</option><option value="f2">01. 三维CG</option><option value="f3">参考素材</option>';
p.renderFolderMenu();
JSON.stringify({ panel: !!p.container, options: document.querySelectorAll('.esp-folder-option').length });
