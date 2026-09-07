document.querySelectorAll('.esp-folder-option')[1]?.click();
document.querySelectorAll('.esp-folder-option')[3]?.click();
JSON.stringify({ selected: window.__UIPanel.selectedFolderIds, label: document.querySelector('#esp-folder-trigger-text')?.textContent });
