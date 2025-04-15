const GITHUB_API_BASE = 'https://api.github.com';
const NOTION_API_BASE = 'https://api.notion.com/v1';
const ALARM_NAME = 'syncIssues';

// --- Event Listeners ---

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed. Setting up alarm...');
  createSyncAlarm();
  // Run sync immediately on install if settings exist
  triggerSync();
});

// Note: onStartup event might not be reliable for persistent tasks in MV3.
// Alarms are the preferred way. This listener is kept for potential immediate
// sync on browser start if the alarm wasn't already running.
chrome.runtime.onStartup.addListener(() => {
    console.log('Browser started. Ensuring alarm exists...');
    createSyncAlarm(); // Ensure alarm exists
    // Optionally trigger sync on startup
    // triggerSync();
});


chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('Alarm triggered. Starting sync...');
    triggerSync();
  }
});

// Optional: Listen for messages from popup (e.g., trigger sync after saving settings)
// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   if (request.action === "syncNow") {
//     console.log("Manual sync triggered from popup.");
//     triggerSync().then(() => sendResponse({ status: "Sync started" }))
//                  .catch(error => {
//                      console.error("Manual sync failed:", error);
//                      sendResponse({ status: `Sync failed: ${error.message}` });
//                  });
//     return true; // Indicates asynchronous response
//   }
// });


// --- Core Logic ---

function createSyncAlarm() {
    chrome.alarms.get(ALARM_NAME, (existingAlarm) => {
        if (!existingAlarm) {
            chrome.alarms.create(ALARM_NAME, {
                delayInMinutes: 1, // Start after 1 minute
                periodInMinutes: 5 // Repeat every 5 minutes
            });
            console.log('Sync alarm created.');
        } else {
            console.log('Sync alarm already exists.');
        }
    });
}

async function triggerSync() {
    try {
        const settings = await getSettings();
        if (!settings.githubToken || !settings.githubRepo || !settings.notionToken || !settings.notionDbId) {
            console.warn('Configuration missing. Skipping sync.');
            return;
        }
        await syncIssues(settings);
        console.log('Sync completed successfully.');
    } catch (error) {
        console.error('Error during sync trigger:', error);
    }
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['githubToken', 'githubRepo', 'notionToken', 'notionDbId'], resolve);
  });
}

async function syncIssues(settings) {
    console.log(`Fetching issues for repo: ${settings.githubRepo}`);
    try {
        const issues = await fetchGitHubIssues(settings.githubToken, settings.githubRepo);
        const realIssues = issues.filter(issue => !issue.pull_request); // Filter out pull requests
        console.log(`Found ${realIssues.length} actual issues.`);

        if (realIssues.length === 0) {
            console.log("No new issues to process.");
            return;
        }

        // Process issues sequentially to avoid overwhelming APIs and simplify duplicate check
        // For parallel processing (more complex): use Promise.allSettled
        for (const issue of realIssues) {
            await processIssue(issue, settings);
        }

    } catch (error) {
        console.error('Error fetching or processing GitHub issues:', error);
        // Consider adding user notification here
    }
}


async function processIssue(issue, settings) {
    try {
        const existingPage = await findNotionPageByGitHubId(settings.notionToken, settings.notionDbId, issue.id);

        if (existingPage) {
            console.log(`Issue #${issue.number} (ID: ${issue.id}) already exists in Notion (Page ID: ${existingPage.id}). Checking for updates...`);
            // Optional: Update existing page if state or other fields changed
            // For now, we just skip if it exists.
            // await updateNotionPageIfChanged(issue, existingPage, settings);
        } else {
            console.log(`Issue #${issue.number} (ID: ${issue.id}) not found in Notion. Creating...`);
            await createNotionPage(issue, settings);
            console.log(`Successfully created Notion page for Issue #${issue.number}`);
        }
    } catch (error) {
        console.error(`Error processing Issue #${issue.number} (ID: ${issue.id}):`, error);
    }
}


// --- API Helpers ---

async function fetchGitHubIssues(token, repo) {
  // Format: user/repo
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
      throw new Error('Invalid GitHub repo format. Use "owner/repo".');
  }

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/issues?state=all&sort=updated&direction=desc`; // Fetch all states, sort by update
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
  };

  console.log(`Fetching issues from: ${url}`);
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorData = await response.text();
    console.error("GitHub API Error Response:", errorData);
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  const issues = await response.json();
  console.log(`Fetched ${issues.length} items from GitHub.`);
  return issues; // Returns an array of issues
}


async function findNotionPageByGitHubId(token, dbId, githubIssueId) {
  const url = `${NOTION_API_BASE}/databases/${dbId}/query`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };
  const body = JSON.stringify({
    filter: {
      property: 'GitHub ID', // Ensure this property name matches your Notion DB
      number: {
        equals: githubIssueId,
      },
    },
    page_size: 1 // We only need to know if it exists
  });

//   console.log(`Querying Notion for GitHub ID: ${githubIssueId}`);
  const response = await fetch(url, { method: 'POST', headers, body });

  if (!response.ok) {
    const errorData = await response.text();
    console.error("Notion API Query Error Response:", errorData);
    throw new Error(`Notion API query failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
//   console.log("Notion query response:", data);
  return data.results.length > 0 ? data.results[0] : null;
}


async function createNotionPage(issue, settings) {
  const url = `${NOTION_API_BASE}/pages`;
  const headers = {
    'Authorization': `Bearer ${settings.notionToken}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  // Map GitHub state to Notion Select option name
  const notionState = issue.state === 'open' ? 'Open' : 'Closed'; // Adjust if your Notion options differ

  const body = JSON.stringify({
    parent: { database_id: settings.notionDbId },
    properties: {
      // Ensure these property names EXACTLY match your Notion DB
      'Name': { // Title property
        title: [
          {
            text: {
              content: issue.title,
            },
          },
        ],
      },
      'URL': { // URL property
        url: issue.html_url,
      },
      'State': { // Select property
        select: {
          name: notionState,
        },
      },
      'GitHub ID': { // Number property (for duplicate checking)
          number: issue.id
      }
      // 'Body' property handled via content blocks below
    },
    // Add issue body as content blocks (basic paragraph for now)
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: {
                // Notion API has a limit on text content length per block (e.g., 2000 chars)
                // Truncate or split into multiple blocks if necessary for very long bodies
                content: issue.body ? issue.body.substring(0, 2000) : "(No description)",
              },
            },
          ],
        },
      },
    ],
  });

//   console.log(`Creating Notion page for issue: ${issue.title}`);
  const response = await fetch(url, { method: 'POST', headers, body });

  if (!response.ok) {
    const errorData = await response.text();
    console.error("Notion API Create Page Error Response:", errorData);
    throw new Error(`Notion API create page failed: ${response.status} ${response.statusText}`);
  }

  const newPage = await response.json();
//   console.log("Notion create page response:", newPage);
  return newPage;
}

// Optional: Function to update existing page (if needed)
/*
async function updateNotionPageIfChanged(issue, existingPage, settings) {
    // Compare issue.state, issue.title etc. with existingPage properties
    // If changes detected, call Notion API PATCH /pages/{page_id}
    // Example: Check state change
    const currentNotionState = existingPage.properties['State']?.select?.name;
    const newNotionState = issue.state === 'open' ? 'Open' : 'Closed';

    if (currentNotionState !== newNotionState) {
        console.log(`State changed for Issue #${issue.number}. Updating Notion page ${existingPage.id}...`);
        const url = `${NOTION_API_BASE}/pages/${existingPage.id}`;
        const headers = {
            'Authorization': `Bearer ${settings.notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28',
        };
        const body = JSON.stringify({
            properties: {
                'State': {
                    select: {
                        name: newNotionState,
                    },
                },
                // Add other properties to update here if needed (e.g., title)
            },
        });

        const response = await fetch(url, { method: 'PATCH', headers, body });
        if (!response.ok) {
            const errorData = await response.text();
            console.error(`Failed to update Notion page ${existingPage.id}:`, errorData);
            throw new Error(`Notion API update page failed: ${response.status} ${response.statusText}`);
        }
        console.log(`Successfully updated Notion page ${existingPage.id}`);
    } else {
        console.log(`No state change detected for Issue #${issue.number}.`);
    }
}
*/

console.log("Background script loaded.");
// Initial check to ensure alarm is set after script is loaded/reloaded
createSyncAlarm(); 