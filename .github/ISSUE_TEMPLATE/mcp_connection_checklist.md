---
name: Penpot MCP Connection Checklist
about: Track your Penpot MCP setup progress
title: 'MCP Setup Progress'
labels: setup, mcp
---

# Penpot MCP Connection Checklist

Use this checklist to track your setup progress:

## Prerequisites
- [ ] I have a Penpot account at design.penpot.app (or self-hosted)
- [ ] I have the original Bowtie design file in Penpot
- [ ] I have Cursor installed (desktop and/or mobile)

## Setup Steps

### In Penpot
- [ ] Logged into Penpot at design.penpot.app
- [ ] Navigated to Your account → Integrations → MCP Server
- [ ] Enabled MCP Server toggle
- [ ] Clicked "Generate MCP Key"
- [ ] Copied the configuration code
- [ ] Kept the Penpot tab open

### In Cursor Desktop (if applicable)
- [ ] Opened Cursor Settings (Cmd/Ctrl + ,)
- [ ] Went to Tools & MCPs section
- [ ] Clicked "Add Custom MCP"
- [ ] Pasted Penpot MCP configuration into mcp.json
- [ ] Saved the file
- [ ] Verified "Penpot MCP" shows green status in settings

### In Cursor Mobile
- [ ] Opened Cursor mobile app
- [ ] Went to Settings → Tools & MCPs
- [ ] Tapped "Add Custom MCP" (or equivalent)
- [ ] Pasted Penpot MCP URL with userToken
- [ ] Saved configuration
- [ ] Verified active/connected status

### Connect Penpot File
- [ ] Opened my Bowtie design file in Penpot (browser)
- [ ] Clicked main menu (☰)
- [ ] Found MCP Server section
- [ ] Verified "Status: enabled"
- [ ] Clicked "Connect" button
- [ ] Status changed to "Connected" with green indicator
- [ ] Kept Penpot tab open in background

### Test Connection
- [ ] Opened this repository in Cursor
- [ ] Tried prompt: "What components are in my Penpot file?"
- [ ] AI responded with actual design information
- [ ] Connection confirmed working! 🎉

## Troubleshooting

If you encounter issues, check:
- [ ] Penpot file is open in browser
- [ ] MCP status shows "Connected" in Penpot
- [ ] MCP configuration saved correctly in Cursor
- [ ] MCP key hasn't been regenerated (old keys stop working)
- [ ] Using latest version of Cursor (especially for mobile)

## Resources

- **Full Guide**: [`PENPOT_MCP_SETUP_GUIDE.md`](../../PENPOT_MCP_SETUP_GUIDE.md)
- **Mobile Quick Start**: [`MOBILE_QUICK_START.md`](../../MOBILE_QUICK_START.md)
- **Project README**: [`README.md`](../../README.md)
- **Penpot MCP Docs**: https://github.com/penpot/penpot/blob/main/docs/mcp/index.md

---

**Note**: This is a tracking issue for personal setup - not a bug report. Once setup is complete, you can close this issue.
