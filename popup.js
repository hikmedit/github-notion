document.addEventListener('DOMContentLoaded', () => {
  // Load saved configuration when popup opens
  loadSavedConfig();
  
  // Set up form submission handler
  const configForm = document.getElementById('configForm');
  configForm.addEventListener('submit', saveConfig);
  
  // Set up sync now button handlers
  const syncNowBtn = document.getElementById('syncNowBtn');
  syncNowBtn.addEventListener('click', triggerSync);
  
  const syncNowBtnMain = document.getElementById('syncNowBtnMain');
  syncNowBtnMain.addEventListener('click', triggerSync);
  
  // Set up toggle config button handler
  const toggleConfigBtn = document.getElementById('toggleConfigBtn');
  toggleConfigBtn.addEventListener('click', toggleConfigForm);
  
  // Set up tab handlers
  setupTabs();
  
  // Set up add task form handler
  const addTaskForm = document.getElementById('addTaskForm');
  addTaskForm.addEventListener('submit', addTaskToNotion);
});

// Set up tab functionality
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and tab contents
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding content
      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab');
      document.getElementById(tabId + 'Tab').classList.add('active');
    });
  });
}

// Load saved configuration from chrome.storage.local
function loadSavedConfig() {
  chrome.storage.local.get(['githubToken', 'githubRepo', 'notionToken', 'notionDatabaseId'], (result) => {
    if (result.githubToken) {
      document.getElementById('githubToken').value = result.githubToken;
    }
    
    if (result.githubRepo) {
      document.getElementById('githubRepo').value = result.githubRepo;
    }
    
    if (result.notionToken) {
      document.getElementById('notionToken').value = result.notionToken;
    }
    
    if (result.notionDatabaseId) {
      document.getElementById('notionDatabaseId').value = result.notionDatabaseId;
    }
    
    // Enable or disable sync now button based on whether config is complete
    updateSyncButtonState(result);
    
    // If configuration is complete, show summary view
    if (isConfigValid(result)) {
      updateConfigSummary(result);
      showSummaryView();
    } else {
      showConfigForm();
    }
  });
}

// Add a task to Notion
function addTaskToNotion(event) {
  event.preventDefault();
  
  // Get the task details
  const title = document.getElementById('taskTitle').value.trim();
  const description = document.getElementById('taskDescription').value.trim();
  const status = document.getElementById('taskStatus').value;
  
  if (!title) {
    showStatus('Task title is required', 'error');
    return;
  }
  
  // Get the Notion credentials
  chrome.storage.local.get(['notionToken', 'notionDatabaseId'], (result) => {
    if (!result.notionToken || !result.notionDatabaseId) {
      showStatus('Notion configuration is incomplete. Please check your settings.', 'error');
      return;
    }
    
    // Show loading state
    const addTaskBtn = document.querySelector('#addTaskForm button[type="submit"]');
    addTaskBtn.disabled = true;
    addTaskBtn.innerHTML = '<span class="icon">⏳</span>Adding...';
    
    // Send to background script to create the task
    chrome.runtime.sendMessage({
      action: 'addTask',
      notionToken: result.notionToken,
      notionDatabaseId: result.notionDatabaseId,
      task: {
        title,
        description,
        status
      }
    }, (response) => {
      // Reset button state
      addTaskBtn.disabled = false;
      addTaskBtn.innerHTML = '<span class="icon">➕</span>Add Task';
      
      if (response && response.success) {
        showStatus('Task added successfully to Notion', 'success');
        
        // Clear the form
        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDescription').value = '';
        document.getElementById('taskStatus').value = 'Open';
      } else {
        const errorMessage = response && response.message 
          ? response.message 
          : 'Failed to add task. Please try again.';
        showStatus(errorMessage, 'error');
      }
    });
  });
}

// Show configuration summary view
function showSummaryView() {
  document.getElementById('configForm').classList.add('hidden');
  document.getElementById('configSummary').classList.remove('hidden');
  document.getElementById('toggleConfigBtn').classList.remove('hidden');
}

// Show configuration form
function showConfigForm() {
  document.getElementById('configForm').classList.remove('hidden');
  document.getElementById('configSummary').classList.add('hidden');
  document.getElementById('toggleConfigBtn').classList.add('hidden');
}

// Toggle between configuration form and summary view
function toggleConfigForm() {
  const form = document.getElementById('configForm');
  if (form.classList.contains('hidden')) {
    showConfigForm();
  } else {
    showSummaryView();
  }
}

// Update the configuration summary view
function updateConfigSummary(config) {
  document.getElementById('summaryRepo').textContent = config.githubRepo || '-';
  document.getElementById('summaryDbId').textContent = formatDatabaseId(config.notionDatabaseId) || '-';
}

// Format the database ID for display (show only part of it)
function formatDatabaseId(dbId) {
  if (!dbId) return '-';
  // Show only first and last few characters
  if (dbId.length > 15) {
    return dbId.substring(0, 8) + '...' + dbId.substring(dbId.length - 4);
  }
  return dbId;
}

// Save configuration to chrome.storage.local
function saveConfig(event) {
  event.preventDefault();
  
  const githubToken = document.getElementById('githubToken').value.trim();
  const githubRepo = document.getElementById('githubRepo').value.trim();
  const notionToken = document.getElementById('notionToken').value.trim();
  const notionDatabaseId = document.getElementById('notionDatabaseId').value.trim();
  
  // Validate inputs
  if (!githubToken || !githubRepo || !notionToken || !notionDatabaseId) {
    showStatus('All fields are required', 'error');
    return;
  }
  
  // Validate GitHub repo format
  if (!isValidGitHubRepo(githubRepo)) {
    showStatus('GitHub repository should be in format: username/repository', 'error');
    return;
  }
  
  // Save to chrome.storage.local
  const config = {
    githubToken,
    githubRepo,
    notionToken,
    notionDatabaseId,
    lastSyncTime: null // Reset last sync time to ensure full sync on next run
  };
  
  chrome.storage.local.set(config, () => {
    showStatus('Configuration saved successfully', 'success');
    
    // Update sync button state
    updateSyncButtonState(config);
    
    // Show the summary view after saving
    updateConfigSummary(config);
    showSummaryView();
  });
}

// Trigger manual sync
function triggerSync() {
  // Use either visible sync button or the one in the form
  const syncBtn = document.getElementById('configForm').classList.contains('hidden') 
    ? document.getElementById('syncNowBtnMain')
    : document.getElementById('syncNowBtn');
  
  // Check if we have config first
  chrome.storage.local.get(['githubToken', 'githubRepo', 'notionToken', 'notionDatabaseId'], (result) => {
    if (!isConfigValid(result)) {
      showStatus('Please save configuration before syncing', 'error');
      return;
    }
    
    // Update button state during sync
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<span class="icon">⏳</span>Syncing...';
    
    // Show status
    showStatus('Syncing GitHub issues to Notion...', 'success');
    
    // Send message to background script
    chrome.runtime.sendMessage({ action: 'manualSync' }, (response) => {
      // When we get a response from the background script
      syncBtn.disabled = false;
      syncBtn.innerHTML = '<span class="icon">🔄</span>Sync Now';
      
      if (response && response.success) {
        if (response.issuesCount === 0) {
          showStatus('No new issues to sync', 'success');
        } else {
          showStatus(`Synced ${response.syncedCount} issues successfully, ${response.failedCount} failed`, 'success');
        }
      } else {
        const errorMessage = response && response.message 
          ? response.message 
          : 'Sync failed. Check console for details.';
        
        // Check for specific error cases
        if (errorMessage.includes('Could not find database with ID') || 
            errorMessage.includes('object_not_found')) {
          showNotionDatabaseError(result.notionDatabaseId);
        } else if (errorMessage.includes('Could not find property with name or id: GitHub ID')) {
          showNotionPropertyError();
        } else if (errorMessage.includes('Notion database is missing required properties')) {
          showMissingPropertiesError(result.notionToken, result.notionDatabaseId);
        } else {
          showStatus(errorMessage, 'error');
        }
      }
    });
  });
}

// Show specialized error for Notion database not found
function showNotionDatabaseError(databaseId) {
  const statusElement = document.getElementById('status');
  statusElement.innerHTML = `
    <strong>Notion Veritabanı Hatası:</strong><br>
    <p>"${databaseId}" ID'li veritabanı bulunamadı veya entegrasyonla paylaşılmadı.</p>
    <p>Çözüm için:</p>
    <ol>
      <li>Notion'da entegrasyon oluşturduğunuzdan emin olun</li>
      <li>Veritabanı ID'sini doğru formatta girdiğinizi kontrol edin (tireleri kaldırmayı deneyin)</li>
      <li>Veritabanını entegrasyonla paylaşın:
        <ul>
          <li>Veritabanı sayfasında sağ üstteki "Share" düğmesine tıklayın</li>
          <li>"Invite" bölümüne entegrasyon adınızı girin ve erişim verin</li>
        </ul>
      </li>
    </ol>
  `;
  statusElement.className = 'status error';
  
  // Make error message stay visible longer
  setTimeout(() => {
    statusElement.className = 'status hidden';
  }, 15000);
}

// Show specialized error for missing Notion property
function showNotionPropertyError() {
  const statusElement = document.getElementById('status');
  statusElement.innerHTML = `
    <strong>Notion Veritabanı Yapılandırma Hatası:</strong><br>
    <p>Veritabanınızda "GitHub ID" adlı bir özellik bulunamadı.</p>
    <p>Çözüm için aşağıdaki adımları izleyin:</p>
    <ol>
      <li>Notion'da veritabanınızı açın</li>
      <li>Sağ üstteki "..." (üç nokta) menüsüne tıklayın</li>
      <li>"Properties" (Özellikler) seçeneğini seçin</li>
      <li>"Add a property" (Özellik ekle) düğmesine tıklayın</li>
      <li>Özellik adı olarak tam olarak "GitHub ID" yazın</li>
      <li>Özellik türü olarak "Number" (Sayı) seçin</li>
      <li>Ayarları kaydedin ve tekrar senkronizasyonu deneyin</li>
    </ol>
    <p>Not: Özellik adı büyük/küçük harfe duyarlıdır ve tam olarak "GitHub ID" olmalıdır.</p>
  `;
  statusElement.className = 'status error';
  
  // Make error message stay visible longer
  setTimeout(() => {
    statusElement.className = 'status hidden';
  }, 20000);
}

// Show specialized error for missing Notion database properties
function showMissingPropertiesError(notionToken, databaseId) {
  const statusElement = document.getElementById('status');
  statusElement.innerHTML = `
    <strong>Notion Veritabanı Özellik Hatası:</strong><br>
    <p>Veritabanınızda gerekli özellikler bulunamadı.</p>
    <p>GitHub Issues'ları Notion'a aktarmak için aşağıdaki özelliklerin veritabanında bulunması gerekiyor:</p>
    <ul>
      <li><strong>Name</strong> (başlık/title türünde)</li>
      <li><strong>URL</strong> (url türünde)</li>
      <li><strong>State</strong> (seçim/select türünde)</li>
      <li><strong>GitHub ID</strong> (sayı/number türünde)</li>
    </ul>
    <p>Özellikleri manuel olarak eklemek için:</p>
    <ol>
      <li>Notion'da veritabanınızı açın</li>
      <li>Sağ üstteki "..." (üç nokta) menüsüne tıklayın</li>
      <li>"Properties" (Özellikler) seçeneğini seçin</li>
      <li>Her özellik için "Add a property" (Özellik ekle) düğmesine tıklayıp, tam olarak yukarıdaki adları ve türleri girin</li>
    </ol>
    <p><button id="createPropertiesBtn" class="primary">Özellikleri Otomatik Ekle</button></p>
  `;
  statusElement.className = 'status error';
  
  // Add click handler for the create properties button
  setTimeout(() => {
    const createPropertiesBtn = document.getElementById('createPropertiesBtn');
    if (createPropertiesBtn) {
      createPropertiesBtn.addEventListener('click', () => {
        createPropertiesBtn.disabled = true;
        createPropertiesBtn.textContent = 'Ekleniyor...';
        
        // Send message to background script to create properties
        chrome.runtime.sendMessage({ 
          action: 'createNotionProperties',
          notionToken,
          databaseId 
        }, (response) => {
          if (response && response.success) {
            showStatus('Veritabanı özellikleri başarıyla eklendi! Şimdi senkronizasyon yapabilirsiniz.', 'success');
          } else {
            const errorMessage = response && response.message 
              ? response.message 
              : 'Özellikler eklenirken hata oluştu. Lütfen manuel olarak ekleyin.';
            showStatus(errorMessage, 'error');
          }
        });
      });
    }
  }, 100);
  
  // Keep error visible for longer
  setTimeout(() => {
    statusElement.className = 'status hidden';
  }, 30000);
}

// Update sync button state based on config
function updateSyncButtonState(config) {
  const syncBtn = document.getElementById('syncNowBtn');
  
  if (isConfigValid(config)) {
    syncBtn.disabled = false;
  } else {
    syncBtn.disabled = true;
  }
}

// Check if config is valid
function isConfigValid(config) {
  return config.githubToken && config.githubRepo && config.notionToken && config.notionDatabaseId;
}

// Validate GitHub repository format (username/repository)
function isValidGitHubRepo(repo) {
  return /^[a-zA-Z0-9-_.]+\/[a-zA-Z0-9-_.]+$/.test(repo);
}

// Show status message
function showStatus(message, type) {
  const statusElement = document.getElementById('status');
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
  
  // Hide after 3 seconds
  setTimeout(() => {
    statusElement.className = 'status hidden';
  }, 3000);
} 