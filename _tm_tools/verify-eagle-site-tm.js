const path = require('path');
const { Level } = require('level');
const dbPath = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Local Extension Settings', 'iikmkjmpaadaobahmlepeloendndfphd');
const sourceKey = '!extdb.@source#bc3ffafb-633c-4f2c-983c-3225536e5d00';
(async () => {
  const db = new Level(dbPath, { valueEncoding: 'utf8' });
  await db.open();
  try {
    const sourceRaw = await db.get(sourceKey);
    const sourceObj = JSON.parse(sourceRaw);
    const code = String(sourceObj.value || '');
    const eagleApiStart = code.indexOf('const EagleAPI = {');
    const imageExtractorStart = code.indexOf('const ImageExtractor = {');
    const tagCatalogMethod = code.indexOf('async getTagCatalog');
    const checks = {
      hasCurrentVersion: code.includes('// @version      1.1.6'),
      hasConfigurableTimeout: code.includes('timeout: opts.timeout || 5000'),
      hasBase64UploadTimeout: code.includes('const uploadTimeout = Math.min(180000'),
      hasRemoteUploadTimeout: code.includes('timeout: 90000'),
      hasLocalizedFabMediaSupport: code.includes('button[data-media="true"]')
        && code.includes('label.match(/(\\d+)\\s*$/)'),
      respectsSelectedFolder: code.includes('return manuallySelected;'),
      createsFabFolderUnderSelection: code.includes('EagleAPI.createFolder(folderName, manuallySelected)'),
      preservesBaseFolderSelection: code.includes('this.folderId = found.id;'),
      hasFolderTreeFromApi: code.includes('normalizeFolderNodes(this.folders)') && code.includes('folder.children'),
      hasOfficialFolderPickerUI: code.includes('esp-folder-recent') && code.includes('esp-picker-footer') && code.includes('esp-folder-menu'),
      hasCompactFolderPickerWidth: code.includes('width: min(420px, calc(100vw - 20px))'),
      hasTagPickerUI: code.includes('esp-tag-trigger') && code.includes('esp-tag-menu') && code.includes('esp-tag-list'),
      hasEagleTagApi: code.includes("/api/v2/tag/get") && code.includes("/api/v2/tagGroup/get"),
      // 标签方法必须属于 EagleAPI；此前误放进 UIPanel，导致调用时报“不是函数”。
      tagCatalogOwnedByEagleApi: eagleApiStart >= 0
        && imageExtractorStart > eagleApiStart
        && tagCatalogMethod > eagleApiStart
        && tagCatalogMethod < imageExtractorStart,
      hasGroupedTagRenderer: code.includes('renderEagleTagMenu') && code.includes('esp-tag-group-title'),
      hasCompactOfficialTagLayout: code.includes('width: min(420px, calc(100vw - 20px))')
        && code.includes('height: min(600px, calc(100vh - 24px))')
        && code.includes('gap: 0 4px')
        && code.includes('min-height: 26px'),
      hasViewportAdaptivePicker: code.includes('positionPickerMenu(menu, trigger, desiredHeight)')
        && code.includes('availableBelow')
        && code.includes('availableAbove')
        && code.includes("menu.style.bottom = openAbove"),
      hasFolderCheckboxUI: code.includes('esp-folder-option-checkbox') && code.includes('esp-folder-option-icon'),
      folderRowExpandsWithoutSelecting: code.includes('if (event.target === item && children.length > 0)') && code.includes('toggleFolderSelection(node.id)'),
      hasRecentTagState: code.includes('eagle.scraper.recentTags') && code.includes('selectedTags'),
      // 当前版本按实际选中的文件夹数组决定是否校验，旧版单 folderId 断言已废弃。
      hasFolderVerificationControl: code.includes('verifyFolders: selectedFolderIds.length > 0'),
     hasSimpleStartButton: code.includes('border-color: rgba(177, 215, 248, 0.62);'),
     noForcedSaveAsButton: !code.includes('id="esp-local-save-as"'),
      noLegacyFolderCheckNode: !code.includes("check.className = 'esp-folder-option-check'"),
      hasTagLegacyFallback: code.includes("/api/tag/list"),
      hasTagGroupDegradedMode: code.includes("分组接口不可用"),
      hasTriggerTextLayout: code.includes("flex: 1 1 auto;") && code.includes("#esp-folder-trigger-text"),
     bytes: Buffer.byteLength(code),
    };
    console.log(JSON.stringify(checks, null, 2));
    if (Object.entries(checks).some(([key, value]) => key !== 'bytes' && value !== true)) process.exit(2);
  } finally {
    await db.close();
  }
})().catch(err => { console.error(err && err.stack || err); process.exit(1); });
