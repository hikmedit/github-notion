// Initialize alarm when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  // Create an alarm that fires every 5 minutes
  chrome.alarms.create('syncGitHubIssues', { periodInMinutes: 5 });
  console.log('GitHub to Notion sync alarm created');
});

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncGitHubIssues') {
    syncGitHubIssues();
  }
});

// Also sync when the browser starts
chrome.runtime.onStartup.addListener(() => {
  syncGitHubIssues();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'manualSync') {
    console.log('Manual sync triggered');
    
    // Run sync and return results to popup
    syncGitHubIssues()
      .then(result => {
        if (result) {
          sendResponse({ success: true, ...result });
        } else {
          sendResponse({ success: false, message: 'No issues to sync or configuration incomplete' });
        }
      })
      .catch(error => {
        console.error('Error during sync:', error);
        sendResponse({ success: false, message: error.message });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  } else if (message.action === 'createNotionProperties') {
    console.log('Creating Notion database properties');
    
    // Create required properties in Notion database
    createNotionDatabaseProperties(message.notionToken, message.databaseId)
      .then(result => {
        sendResponse({ success: true, message: 'Properties created successfully' });
      })
      .catch(error => {
        console.error('Error creating properties:', error);
        sendResponse({ success: false, message: error.message });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
});

async function syncGitHubIssues() {
  try {
    // Get configuration from storage
    const config = await getConfig();
    if (!isConfigValid(config)) {
      console.log('Configuration incomplete, skipping sync');
      return null;
    }

    // Fetch issues from GitHub
    const issues = await fetchGitHubIssues(config);
    if (!issues || issues.length === 0) {
      console.log('No issues to sync');
      return { issuesCount: 0 };
    }

    console.log(`Fetched ${issues.length} issues from GitHub`);

    // Sync to Notion
    const result = await syncToNotion(issues, config);

    console.log('Sync completed successfully');
    return {
      issuesCount: issues.length,
      syncedCount: result.successful,
      failedCount: result.failed
    };
  } catch (error) {
    console.error('Error during sync:', error);
    throw error;
  }
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['githubToken', 'githubRepo', 'notionToken', 'notionDatabaseId', 'lastSyncTime'], (result) => {
      resolve(result);
    });
  });
}

function isConfigValid(config) {
  return config.githubToken && config.githubRepo && config.notionToken && config.notionDatabaseId;
}

async function fetchGitHubIssues(config) {
  const { githubToken, githubRepo, lastSyncTime } = config;
  
  // Construct the API URL
  let url = `https://api.github.com/repos/${githubRepo}/issues?state=all&sort=updated&direction=desc`;
  
  // If we have a last sync time, only fetch issues updated since then
  if (lastSyncTime) {
    const since = new Date(lastSyncTime).toISOString();
    url += `&since=${since}`;
  }
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const issues = await response.json();
  
  // Filter out pull requests
  return issues.filter(issue => !issue.pull_request);
}

async function syncToNotion(issues, config) {
  const { notionToken, notionDatabaseId } = config;
  
  // Fix database ID format if needed
  const formattedDatabaseId = formatNotionDatabaseId(notionDatabaseId);
  
  try {
    // First check if the database has the required properties
    await checkNotionDatabaseProperties(notionToken, formattedDatabaseId);
    
    // Process issues in batches to avoid overwhelming the API
    const results = await Promise.allSettled(issues.map(issue => 
      createOrUpdateNotionPage(issue, notionToken, formattedDatabaseId)
    ));
    
    // Update last sync time
    chrome.storage.local.set({ lastSyncTime: new Date().toISOString() });
    
    // Log results
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`Sync results: ${successful} successful, ${failed} failed`);
    
    // Return results for potential UI updates
    return { successful, failed };
  } catch (error) {
    console.error('Error during sync to Notion:', error);
    throw error;
  }
}

// Format Notion database ID to handle variations in format
function formatNotionDatabaseId(databaseId) {
  // Remove any hyphens
  let formatted = databaseId.replace(/-/g, '');
  
  // If the length is 32 characters after removing hyphens, format it with hyphens
  if (formatted.length === 32) {
    return formatted.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5');
  }
  
  // Otherwise, return as is
  return databaseId;
}

async function createOrUpdateNotionPage(issue, notionToken, databaseId) {
  const { title, html_url, state, body, id, updated_at } = issue;
  
  try {
    // Search if this issue already exists in the database
    const existingPage = await findExistingIssuePage(id, notionToken, databaseId);
    
    // If the issue exists and hasn't been updated, skip it
    if (existingPage && new Date(existingPage.last_edited_time) >= new Date(updated_at)) {
      console.log(`Issue #${id} already up-to-date in Notion`);
      return;
    }
    
    // Prepare the Notion page properties
    const properties = {
      'Name': {
        title: [
          {
            text: {
              content: title
            }
          }
        ]
      },
      'URL': {
        url: html_url
      },
      'State': {
        select: {
          name: state.charAt(0).toUpperCase() + state.slice(1) // Capitalize first letter
        }
      },
      'GitHub ID': {
        number: id
      }
    };
    
    // Prepare the request data
    const requestData = {
      parent: { database_id: databaseId },
      properties
    };
    
    // Only include children (content) if body is not empty and we're creating a new page
    // For existing pages (PATCH), we should not include empty children
    if (body && body.trim() && !existingPage) {
      requestData.children = [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: body
                }
              }
            ]
          }
        }
      ];
    }
    
    // Create a new page or update existing one
    const url = existingPage 
      ? `https://api.notion.com/v1/pages/${existingPage.id}`
      : 'https://api.notion.com/v1/pages';
      
    const method = existingPage ? 'PATCH' : 'POST';
    
    console.log(`Making ${method} request to Notion API: ${url}`);
    
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Notion API error (${response.status}):`, errorText);
      throw new Error(`Notion API error: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error processing issue #${id}:`, error);
    throw error;
  }
}

async function findExistingIssuePage(issueId, notionToken, databaseId) {
  try {
    console.log(`Searching for issue #${issueId} in Notion database ${databaseId}`);
    
    // Query the database for pages with the matching GitHub issue ID
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: {
          property: 'GitHub ID',
          number: {
            equals: issueId
          }
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Notion database query error (${response.status}):`, errorText);
      
      // Try to provide more helpful error message
      if (response.status === 404) {
        console.log('Notion database not found. Please check:');
        console.log('1. Database ID is correct');
        console.log('2. The Notion integration has access to the database');
        console.log('3. The database has a "GitHub ID" property configured');
      }
      
      throw new Error(`Notion database query error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    
    // Return the first matching page or null if none found
    return result.results.length > 0 ? result.results[0] : null;
  } catch (error) {
    console.error(`Error searching for issue #${issueId}:`, error);
    throw error;
  }
}

// Check if the Notion database has all required properties
async function checkNotionDatabaseProperties(notionToken, databaseId) {
  console.log(`Checking properties for Notion database ${databaseId}`);
  
  try {
    // Fetch database schema
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching database schema: ${response.status}`, errorText);
      throw new Error(`Notion database error: ${response.status} - ${errorText}`);
    }
    
    const database = await response.json();
    const properties = database.properties || {};
    
    // Check required properties
    const requiredProperties = [
      { name: 'Name', type: 'title' },
      { name: 'URL', type: 'url' },
      { name: 'State', type: 'select' },
      { name: 'GitHub ID', type: 'number' }
    ];
    
    const missingProperties = [];
    
    for (const prop of requiredProperties) {
      const property = Object.values(properties).find(p => p.name === prop.name);
      if (!property) {
        missingProperties.push(prop);
      } else if (property.type !== prop.type) {
        missingProperties.push({ ...prop, existingType: property.type });
      }
    }
    
    if (missingProperties.length > 0) {
      const missingList = missingProperties.map(p => 
        p.existingType 
          ? `"${p.name}" (found as ${p.existingType}, but should be ${p.type})`
          : `"${p.name}" (type: ${p.type})`
      ).join(', ');
      
      throw new Error(`Notion database is missing required properties: ${missingList}`);
    }
    
    console.log('All required properties found in Notion database');
    return true;
  } catch (error) {
    console.error('Error checking Notion database properties:', error);
    throw error;
  }
}

// Create required properties in a Notion database
async function createNotionDatabaseProperties(notionToken, databaseId) {
  console.log(`Creating properties for Notion database ${databaseId}`);
  
  try {
    // Fix database ID format if needed
    const formattedDatabaseId = formatNotionDatabaseId(databaseId);
    
    // First, fetch the current database structure
    const response = await fetch(`https://api.notion.com/v1/databases/${formattedDatabaseId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching database: ${response.status}`, errorText);
      throw new Error(`Notion database error: ${response.status} - ${errorText}`);
    }
    
    const database = await response.json();
    
    // Prepare updated database with required properties
    const updatedProperties = { ...database.properties };
    
    // Title property (Name) is special - if it doesn't exist, we need to rename an existing title
    const existingTitleProp = Object.values(updatedProperties).find(p => p.type === 'title');
    
    // If a title property already exists with different name, we'll need to use it
    if (existingTitleProp && existingTitleProp.name !== 'Name') {
      // Remember the old name for logging
      const oldTitleName = existingTitleProp.name;
      
      // Rename it to "Name"
      delete updatedProperties[oldTitleName];
      updatedProperties['Name'] = {
        title: {}
      };
      
      console.log(`Renamed title property from "${oldTitleName}" to "Name"`);
    } else if (!existingTitleProp) {
      // Every database must have a title property, so this is unlikely
      updatedProperties['Name'] = {
        title: {}
      };
    }
    
    // Add URL property if it doesn't exist
    if (!Object.values(updatedProperties).find(p => p.name === 'URL')) {
      updatedProperties['URL'] = {
        url: {}
      };
    }
    
    // Add State property if it doesn't exist
    if (!Object.values(updatedProperties).find(p => p.name === 'State')) {
      updatedProperties['State'] = {
        select: {
          options: [
            { name: 'Open', color: 'green' },
            { name: 'Closed', color: 'red' }
          ]
        }
      };
    }
    
    // Add GitHub ID property if it doesn't exist
    if (!Object.values(updatedProperties).find(p => p.name === 'GitHub ID')) {
      updatedProperties['GitHub ID'] = {
        number: {}
      };
    }
    
    // Update the database
    const updateResponse = await fetch(`https://api.notion.com/v1/databases/${formattedDatabaseId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: updatedProperties
      })
    });
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`Error updating database: ${updateResponse.status}`, errorText);
      throw new Error(`Notion database update error: ${updateResponse.status} - ${errorText}`);
    }
    
    const updatedDatabase = await updateResponse.json();
    console.log('Successfully updated Notion database properties');
    
    return updatedDatabase;
  } catch (error) {
    console.error('Error creating Notion database properties:', error);
    throw error;
  }
} 