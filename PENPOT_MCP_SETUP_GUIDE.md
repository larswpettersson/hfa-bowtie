# Penpot MCP Setup Guide for Cursor

This guide will help you connect your Cursor app (desktop and mobile) to Penpot MCP.

## Quick Reference

Your repository contains:
- `Bowtie.html` - Bowtie diagram editor (created from Penpot components)
- Design tokens live in [hfa-ds](https://github.com/larswpettersson/hfa-ds) — not in this repo

## Setup Checklist

### ✅ Step 1: Access Your Penpot Design File

1. Go to [design.penpot.app](https://design.penpot.app)
2. Log in to your account
3. Locate your **original Bowtie design file** (the one used to create `Bowtie.html`)
4. Keep this tab open - you'll need it later

**Note**: The HTML comments in `Bowtie.html` mention "Restored from Penpot components" - find that original file!

---

### ✅ Step 2: Enable MCP in Penpot

1. In Penpot, click your profile icon (top-right)
2. Select **Your account**
3. Go to **Integrations** section
4. Find **MCP Server**
5. Toggle it to **Enable**
6. Click **Generate MCP Key** button
7. A modal will appear with two sections:
   - **Configuration code** (larger text area)
   - **Your MCP URL** (with your userToken)

**⚠️ IMPORTANT**: Keep this page open! You'll copy this configuration in the next step.

**Example of what you'll see:**
```json
{
  "mcpServers": {
    "penpot": {
      "url": "https://design.penpot.app/mcp/stream?userToken=abc123xyz..."
    }
  }
}
```

---

### ✅ Step 3A: Configure Cursor Desktop (if you use it)

1. Open **Cursor Settings** (Cmd/Ctrl + ,)
2. Navigate to **Tools & MCPs** (or search for "MCP")
3. Click **Add Custom MCP** button
4. A file called `mcp.json` will open
5. **Copy the entire configuration** from Penpot's integration page
6. **Paste it** into `mcp.json`
7. **Save the file** (Cmd/Ctrl + S)
8. Go back to **Settings → Tools & MCPs**
9. Verify you see **"Penpot MCP"** listed with a **green status icon** ✅

**If you already have other MCP servers configured:**
Just add the Penpot entry inside the `mcpServers` object:
```json
{
  "mcpServers": {
    "other-server": {
      "url": "..."
    },
    "penpot": {
      "url": "https://design.penpot.app/mcp/stream?userToken=YOUR_TOKEN"
    }
  }
}
```

---

### ✅ Step 3B: Configure Cursor Mobile

1. Open **Cursor mobile app**
2. Tap the **menu icon** (≡) or settings gear
3. Go to **Settings**
4. Look for **Tools & MCPs** or **MCP Servers** section
5. Tap **Add MCP Server** or **Add Custom MCP**
6. You may be able to:
   - Paste the full JSON configuration, OR
   - Enter just the URL field manually
7. Paste your Penpot MCP URL:
   ```
   https://design.penpot.app/mcp/stream?userToken=YOUR_TOKEN_HERE
   ```
8. Save/confirm
9. Verify the connection shows as **active/connected**

**Note**: The exact UI may vary by Cursor mobile version, but the concept is the same - add the MCP server URL with your token.

---

### ✅ Step 4: Connect Your Penpot File to MCP

Now go back to your Penpot design file in the browser:

1. **Open your Bowtie design file** in Penpot
2. Click the **main menu icon** (☰) in the top-left
3. Scroll down to find the **MCP Server** section
4. You should see:
   - **Status: enabled** ✅
   - A **Connect** button (or "Disconnect" if already connected)
5. Click **Connect**
6. The status should change to **"Connected"** with a green indicator
7. Keep this Penpot tab open while using Cursor

**Troubleshooting**:
- If you don't see the MCP Server section, make sure you enabled MCP in Step 2
- If connection fails, verify your MCP key is still valid (check integrations page)
- The Penpot file must remain open in a browser for MCP to work

---

### ✅ Step 5: Test the Connection

Now test from Cursor (desktop or mobile):

**Open this repository in Cursor and try these prompts:**

1. **Query your design:**
   ```
   What components are in my Penpot file?
   ```

2. **Get design information:**
   ```
   Show me the color tokens from my Penpot design
   ```

3. **Generate code:**
   ```
   Generate CSS variables from my Penpot design tokens
   ```

4. **Specific to your Bowtie app:**
   ```
   What are the dimensions of the Toolbar component in my Penpot file?
   ```

If the AI can respond with actual information from your Penpot design, **you're connected!** 🎉

---

## How to Use MCP with Your Bowtie Project

Once connected, you can use prompts like:

### Design Queries
- "What colors are used in the Action Button component?"
- "Show me all the barrier types in the Penpot file"
- "What fonts are specified in the design?"

### Code Generation
- "Update the CSS in Bowtie.html to match the latest toolbar design in Penpot"
- "Generate a new node component based on the Hazard shape from Penpot"
- "Export the color palette from Penpot and update hfa-ds/tokens.json"

### Sync & Update
- "Check if the border-radius values in Bowtie.html match my Penpot design"
- "Update the shadow styles to match what's in Penpot"
- "Compare the spacing in my HTML with the Penpot file"

---

## Important Notes

### Security
- Your `userToken` is like a password - **never share it publicly**
- Anyone with your token can access your Penpot files while MCP is enabled
- You can **regenerate** the key anytime from Penpot Integrations (old keys stop working)
- To disable: Go to Penpot → Your account → Integrations → MCP Server → Disable

### How It Works
- **Penpot MCP** = Bridge between Cursor AI and your Penpot design files
- **Not automatic sync** = You use AI prompts to pull information and generate code
- **Browser required** = Your Penpot file must be open in a browser for MCP to access it
- **Works on both devices** = Same MCP key works for desktop and mobile Cursor

### Workflow
1. Make design changes in Penpot
2. Ask Cursor AI to query the updated design
3. Generate code updates for `Bowtie.html`
4. The HTML file stays standalone (no runtime dependencies on Penpot)

---

## Troubleshooting

### "MCP server not found" in Cursor
- Check that you saved the `mcp.json` configuration
- Verify the URL includes your `userToken`
- Restart Cursor after adding MCP configuration

### "Cannot connect to Penpot file"
- Make sure your Penpot design file is open in a browser
- Click "Connect" in the File menu → MCP Server section
- Verify MCP is enabled in Your account → Integrations

### "Token invalid"
- Your MCP key may have been regenerated
- Go to Penpot Integrations, copy the new configuration
- Update `mcp.json` in Cursor with the new token

### Mobile app can't find MCP settings
- Update to the latest version of Cursor mobile
- MCP support may be rolling out gradually
- Try restarting the app after updating

### AI can't access my Penpot file
- Verify the green "Connected" status in your Penpot file
- Try disconnecting and reconnecting in the File menu
- Make sure you're in the correct Penpot file (the Bowtie one)
- Check that MCP is still enabled (not disabled by accident)

---

## Current Repository Status

✅ Repository is ready for MCP integration:
- `Bowtie.html` - Your working Bowtie editor
- [hfa-ds/tokens.json](https://github.com/larswpettersson/hfa-ds/blob/main/tokens.json) - Design tokens from Penpot (canonical repo: hfa-ds)
- `.git` - Version control configured
- Comments in HTML confirm Penpot origin

**Next step**: Follow Steps 1-5 above to complete the MCP setup!

---

## Need Help?

If you encounter issues:
1. Check the Penpot MCP documentation: [Penpot MCP Docs](https://github.com/penpot/penpot/blob/main/docs/mcp/index.md)
2. Verify your Cursor version supports MCP (recent versions)
3. Try the connection from Cursor desktop first (more mature than mobile)
4. Check Penpot's blog for setup guides: [Penpot MCP Blog Posts](https://penpot.app/blog/)

---

**Ready to start? Begin with Step 1! ☝️**
