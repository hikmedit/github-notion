document.addEventListener('DOMContentLoaded', () => {
  const githubTokenInput = document.getElementById('githubToken');
  const githubRepoInput = document.getElementById('githubRepo');
  const notionTokenInput = document.getElementById('notionToken');
  const notionDbIdInput = document.getElementById('notionDbId');
  const saveButton = document.getElementById('saveButton');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  chrome.storage.local.get([
    'githubToken',
    'githubRepo',
    'notionToken',
    'notionDbId'
  ], (result) => {
    githubTokenInput.value = result.githubToken || '';
    githubRepoInput.value = result.githubRepo || '';
    notionTokenInput.value = result.notionToken || '';
    notionDbIdInput.value = result.notionDbId || '';
  });

  // Save settings
  saveButton.addEventListener('click', () => {
    const settings = {
      githubToken: githubTokenInput.value.trim(),
      githubRepo: githubRepoInput.value.trim(),
      notionToken: notionTokenInput.value.trim(),
      notionDbId: notionDbIdInput.value.trim()
    };

    chrome.storage.local.set(settings, () => {
      statusDiv.textContent = 'Settings saved!';
      // Optionally trigger background sync immediately
      // chrome.runtime.sendMessage({ action: "syncNow" }, (response) => {
      //   console.log(response.status);
      // });
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2000);
    });
  });
}); 