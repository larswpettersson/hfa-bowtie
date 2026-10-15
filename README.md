# Bowtie Diagram Editor

**🔗 Live: [larswpettersson.github.io/hfa-bowtie/Bowtie.html](https://larswpettersson.github.io/hfa-bowtie/Bowtie.html)** · [offline-version](https://larswpettersson.github.io/hfa-bowtie/Bowtie_offline.html) (single file)

A standalone HTML5 bowtie diagram editor for safety analysis, designed from Penpot components.

## 📁 Files

- **`Bowtie.html`** - Interactive bowtie diagram editor with pan/zoom, theme switching, and node editing ([`scripts/bowtie-app.js`](scripts/bowtie-app.js))
- **Design tokens:** canonical source is [hfa-ds/tokens.json](https://github.com/larswpettersson/hfa-ds/blob/main/tokens.json) (not stored in this repo)
- **`PENPOT_MCP_SETUP_GUIDE.md`** - Detailed guide for connecting Cursor to Penpot MCP
- **`MOBILE_QUICK_START.md`** - Quick reference for mobile Cursor setup

## 🎨 Features

- **Interactive Canvas**: Pan, zoom, and edit bowtie diagrams
- **Node Types**: Hazard, Top Event, Causes, Barriers (Preventive/Recovery), Consequences
- **Theme Support**: Light/dark mode with keyboard shortcuts
- **Keyboard Shortcuts**: 
  - `C` - Add Cause
  - `B` - Add Preventive Barrier
  - `R` - Add Recovery Barrier
  - `Q` - Add Consequence
  - `L` - Light mode
  - `D` - Dark mode
- **Inline Editing**: Click any node to edit text inline
- **Barrier Mapping**: Select barriers and click causes/consequences to reassign coverage
- **Responsive**: Works on desktop and mobile browsers

## 🔗 Penpot MCP Integration

This project was created from Penpot design components and can be connected to Penpot MCP for AI-assisted development:

### Quick Setup
1. Enable MCP in [Penpot Integrations](https://design.penpot.app)
2. Add MCP configuration to Cursor (Settings → Tools & MCPs)
3. Connect your Penpot Bowtie file (File → MCP Server → Connect)
4. Use AI prompts to sync design changes and generate code

**See** [`PENPOT_MCP_SETUP_GUIDE.md`](PENPOT_MCP_SETUP_GUIDE.md) for detailed instructions.

**Mobile users**: Check [`MOBILE_QUICK_START.md`](MOBILE_QUICK_START.md) for the 5-minute setup!

## 🚀 Usage

### Running Locally
Simply open `Bowtie.html` in any modern web browser - no build process required!

### Development with Penpot MCP
Once MCP is connected, you can use Cursor AI to:
- Query design specifications from your Penpot file
- Generate code updates based on design changes
- Export design tokens and sync with [hfa-ds/tokens.json](https://github.com/larswpettersson/hfa-ds)
- Create new components matching your Penpot design system

Example prompts:
```
What are the color values in my Penpot design?
Update the toolbar styles to match the latest Penpot design
Generate a new node type based on the Consequence component
```

## 🎯 Design System

Design tokens and shared components live in the Penpot **HFA DS** file (shared library). Bowtie is the design-language authority for colors, typography, and diagram components.

- **Penpot hub:** HFA DS — `mode/light`, `mode/dark`, all shared components
- **Code export:** [hfa-ds/tokens.json](https://github.com/larswpettersson/hfa-ds/blob/main/tokens.json)
- **Penpot sync scripts:** [hfa-ds/scripts/penpot/](https://github.com/larswpettersson/hfa-ds/tree/main/scripts/penpot)
- **Legacy migration notes:** [`scripts/hfa-ds-migration/`](scripts/hfa-ds-migration/) (superseded by hfa-ds repo)

Design tokens are defined in the [hfa-ds](https://github.com/larswpettersson/hfa-ds) repository and imported into Penpot files via MCP. This repo does not contain a local `tokens.json`.

- **Colors**: Background (base/sunken/elevated), semantic (info/warning/success/error), brand (Trafikverket red)
- **Typography:** Source Sans 3 via `roboto-base` token
- **Border Styles**: Normal (1px), Strong (3px), Weak (dashed)
- **Themes**: Light and dark modes with proper contrast ratios

### App entry

| File | Role |
|---|---|
| [`Bowtie.html`](Bowtie.html) | Current app — in-memory state + render-from-state ([`scripts/bowtie-app.js`](scripts/bowtie-app.js)) |

Run smoke checks: `python3 scripts/penpot5-smoke-test.py`

## 📄 License

[Add your license here]

## 👥 Contributing

This project uses Penpot for design and can be developed with Cursor + Penpot MCP integration for seamless design-to-code workflows.

---

**Created from Penpot components** | **Designed for Safety Analysis** | **Mobile-Friendly**
