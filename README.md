# Bowtie Diagram Editor

A standalone HTML5 bowtie diagram editor for safety analysis, designed from Penpot components.

## 📁 Files

- **`prototype.html`** - Interactive bowtie diagram editor with pan/zoom, theme switching, and node editing
- **`tokens.json`** - Design tokens (colors, typography, spacing) for light/dark themes
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
Simply open `prototype.html` in any modern web browser - no build process required!

### Development with Penpot MCP
Once MCP is connected, you can use Cursor AI to:
- Query design specifications from your Penpot file
- Generate code updates based on design changes
- Export design tokens and sync with `tokens.json`
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
- **Code export:** [`tokens.json`](tokens.json) (sync from HFA DS after token changes)
- **Typography:** `roboto-base` token → Source Sans 3 stack (matches `prototype4.html`)
- **Migration scripts:** [`scripts/hfa-ds-migration/`](scripts/hfa-ds-migration/)

This project uses design tokens from `tokens.json` that align with the Penpot design file:

- **Colors**: Background (base/sunken/elevated), semantic (info/warning/success/error), brand (Trafikverket red)
- **Typography:** Source Sans 3 via `roboto-base` token (matches `prototype4.html`)
- **Border Styles**: Normal (1px), Strong (3px), Weak (dashed)
- **Themes**: Light and dark modes with proper contrast ratios

### HTML prototypes

| File | Role |
|---|---|
| [`prototype4.html`](prototype4.html) | Stable reference — DOM-as-source-of-truth |
| [`penpot5.html`](penpot5.html) | Experimental — in-memory state + render-from-state ([`scripts/penpot5-app.js`](scripts/penpot5-app.js)) |

Run smoke checks: `python3 scripts/penpot5-smoke-test.py`

## 📄 License

[Add your license here]

## 👥 Contributing

This project uses Penpot for design and can be developed with Cursor + Penpot MCP integration for seamless design-to-code workflows.

---

**Created from Penpot components** | **Designed for Safety Analysis** | **Mobile-Friendly**
