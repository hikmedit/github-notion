# GitHub to Notion Issues Sync

A Chrome extension that automatically syncs GitHub issues to a Notion database. This extension is designed to help teams keep track of GitHub issues in Notion for better project management and collaboration.

## Features

- Automatically syncs GitHub issues to a Notion database
- Syncs every 5 minutes in the background
- Manual sync option with a single click
- Preserves issue content formatting (headings, code blocks, lists)
- Distinguishes between open and closed issues
- Syncs only actual issues (ignores pull requests)
- Automatically updates existing issues when they change

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the directory containing this extension
5. The extension icon will appear in your browser toolbar

## Setup Requirements

### GitHub Personal Access Token

1. Go to your GitHub Settings → [Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token" (classic)
3. Give it a descriptive name
4. Select at least the `repo` scope to access repository issues
5. Click "Generate token" and copy the generated token

### Notion Integration

1. Go to [Notion's integrations page](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name your integration and select the workspace
4. Click "Submit" to create the integration
5. Copy the "Internal Integration Token"

### Notion Database Setup

1. Create a new database in Notion
2. Share the database with your integration:
   - Open the database
   - Click "Share" in the top-right corner
   - Enter the name of your integration and click "Invite"
3. Get the database ID from the URL:
   - The database ID is the part of the URL after the workspace name and before the query parameters
   - Format: `https://www.notion.so/workspace/DATABASE_ID?v=...`
   - The ID may contain hyphens, which you can include or remove

## Configuration

1. Click the extension icon in your Chrome toolbar
2. Enter the following details:
   - GitHub Token: Your personal access token
   - GitHub Repository: Format `username/repository`
   - Notion Token: Your integration token
   - Notion Database ID: The ID of your database
3. Click "Save Configuration"

## Usage

### Automatic Sync

The extension will automatically:
- Run a sync when the browser starts
- Run a sync every 5 minutes while the browser is open

### Manual Sync

Click the "Sync Now" button to manually sync GitHub issues to Notion.

### View Configuration

After your initial setup, the extension will display a compact view with just the repository and database information. You can:
- Click the "Settings" button to show the full configuration form
- Click "Sync Now" to manually trigger a sync

## Troubleshooting

### Missing Database Properties

If you see an error about missing properties, you can:
1. Click "Add Properties Automatically" to have the extension create them for you, or
2. Manually add these properties to your Notion database:
   - `Name` (title type)
   - `URL` (URL type)
   - `State` (select type)
   - `GitHub ID` (number type)

### Database Not Found

If your database can't be found:
1. Check that the database ID is correct
2. Ensure you've shared the database with your integration
3. Try removing hyphens from the database ID

### API Rate Limits

- GitHub API has rate limits (5000 requests per hour with authentication)
- Notion API also has rate limits
- If you hit these limits, wait a while before trying again

## License

This project is released under the MIT License. Feel free to use, modify, and distribute as needed.

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests if you have suggestions for improvements. 