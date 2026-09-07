const path = require('path');
const { Level } = require('level');
const dbPath = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Local Extension Settings', 'iikmkjmpaadaobahmlepeloendndfphd');
const sourceKey = '!extdb.@source#ed55ac22-9548-41e6-b307-f04805a34b6f';
(async () => {
  const db = new Level(dbPath, { valueEncoding: 'utf8' });
  await db.open();
  try {
    const sourceRaw = await db.get(sourceKey);
    const sourceObj = JSON.parse(sourceRaw);
    const code = String(sourceObj.value || '');
    const checks = {
      hasCurrentVersion: code.includes('// @version            1.1.5'),
      hasFolderSelectUI: code.includes('tmd-batch-folder-select'),
      hasFolderTreeUI: code.includes('tmd-batch-folder-tree') && code.includes('tmd-batch-folder-node'),
      hasFolderTreeData: code.includes('ctx.eagle.folderTreeCache') && code.includes('folderExpandedIds'),
      hasFolderSearchUI: code.includes('folder-search'),
      hasOfficialFolderPickerUI: code.includes('tmd-batch-picker') && code.includes('tmd-batch-picker-menu') && code.includes('tmd-batch-picker-footer'),
      hasCompactFolderPickerWidth: code.includes('width: min(420px, calc(100vw - 20px))'),
      hasTagPickerUI: code.includes('data-action="tags-trigger"') && code.includes('tmd-batch-tag-list') && code.includes('toggleTag'),
      hasEagleTagApi: code.includes("/api/v2/tag/get") && code.includes("/api/v2/tagGroup/get"),
      hasGroupedTagRenderer: code.includes('renderEagleTagOptions') && code.includes('tmd-batch-tag-group-title'),
      hasCompactOfficialTagLayout: code.includes('.tmd-batch-tags-menu {width: min(420px')
        && code.includes('height: min(600px, calc(100vh - 24px))')
        && code.includes('gap: 0 4px')
        && code.includes('min-height: 26px'),
      hasViewportAdaptivePicker: code.includes('positionPickerMenu: function (picker, desiredHeight)')
        && code.includes('availableBelow')
        && code.includes('availableAbove')
        && code.includes("menu.style.bottom = openAbove"),
      hasFolderCheckboxUI: code.includes('tmd-batch-folder-checkbox') && code.includes('tmd-batch-folder-icon'),
      folderRowExpandsWithoutSelecting: code.includes('if (event.target === row && children.length > 0)') && code.includes("checkbox.addEventListener('click'"),
      noSyntheticTagSuggestions: !code.includes("'X', 'photo', 'video', 'gif', 'audio'"),
      hasSelectedTagStorage: code.includes('eagle_selected_tags') && code.includes('eagle_recent_tags'),
      hasSelectedTagsInPayload: code.includes('extraTags: this.selectedTags'),
      hasSelectedFolderStorage: code.includes('eagle_selected_folder_id'),
      hasFolderBindFallback: code.includes('ensureItemFolders'),
      syntaxMarker: code.includes('buildEagleFolderSpec'),
      hasAudioExtraction: code.includes('getMediaDownloadInfo') && code.includes('audio_info') && code.includes('fileType: \'audio\''),
     hasVisibleLauncher: code.includes('tmd-batch-launcher') && code.includes('launcher.onclick'),
     hasAudioSelectors: code.includes('[data-testid*="audio"]') && code.includes('[aria-label*="语音"]'),
      noLegacyFolderCheckNode: !code.includes("tmd-batch-folder-node-check"),
      hasTagLegacyFallback: code.includes("/api/tag/list"),
      hasTagGroupDegradedMode: code.includes("tag-group-list"),
      hasTriggerTextLayout: code.includes("tmd-batch-picker-trigger > span:first-child {flex: 1 1 auto"),
     bytes: Buffer.byteLength(code),
    };
    console.log(JSON.stringify(checks, null, 2));
    if (!Object.entries(checks).filter(([key]) => key !== 'bytes').every(([, value]) => value === true)) process.exit(2);
  } finally {
    await db.close();
  }
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
