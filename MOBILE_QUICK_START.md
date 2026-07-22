# 📱 Penpot MCP Mobile Quick Start

**Goal**: Connect Cursor mobile to your Penpot Bowtie design file

---

## 🚀 5-Minute Setup

### 1️⃣ In Penpot (Browser)
1. Go to: [design.penpot.app](https://design.penpot.app)
2. Click profile → **Your account** → **Integrations**
3. Enable **MCP Server**
4. Click **Generate MCP Key**
5. **Copy the configuration code** (keep tab open!)

### 2️⃣ In Cursor Mobile
1. Open **Settings** ⚙️
2. Find **Tools & MCPs** (or MCP Servers)
3. Tap **Add Custom MCP**
4. Paste the configuration or just the URL:
   ```
   https://design.penpot.app/mcp/stream?userToken=YOUR_TOKEN
   ```
5. Save ✅

### 3️⃣ Back in Penpot
1. Open your **Bowtie design file**
2. Main menu (☰) → **MCP Server** → **Connect**
3. Status should show **"Connected"** ✅
4. **Keep this tab open**

### 4️⃣ Test in Cursor Mobile
Open this repo and ask:
```
What components are in my Penpot file?
```

If it responds with real info → **You're connected!** 🎉

---

## 💡 Quick Commands

Once connected, try these from your phone:

```
What colors are in the Penpot design?
```

```
Show me the Toolbar component dimensions
```

```
Update the button styles in Bowtie.html to match Penpot
```

```
Generate CSS from my Penpot design tokens
```

---

## 🔧 Troubleshooting

**Can't find MCP settings on mobile?**
→ Update Cursor mobile to latest version

**"Connection failed"?**
→ Check Penpot file is open in browser with "Connected" status

**AI doesn't see my design?**
→ Verify you're in the right Penpot file (the Bowtie one!)

---

## 📚 Full Guide

See `PENPOT_MCP_SETUP_GUIDE.md` for detailed instructions

---

**Security Note**: Your MCP token is like a password - keep it private! 🔒
