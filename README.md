# Bowtie Diagram Editor

**🔗 Live: [larswpettersson.github.io/hfa-bowtie/Bowtie.html](https://larswpettersson.github.io/hfa-bowtie/Bowtie.html)**

A standalone HTML5 bowtie diagram editor for safety analysis, designed from Penpot components.

## The HFA tools

Human Factors Analysis (HFA) tools for safety and human factors work. Each tool is a separate repository and runs in the browser without installation, a server or an account. Nothing leaves the browser unless you export it, and the tools also work in isolated (air-gapped) environments through their single-file offline versions. All tools are under development; file formats may change.

| Tool | What it does | Links |
|---|---|---|
| **HTA** | Hierarchical Task Analysis with Tabular Task Analysis (TTA / HEI fields): a task tree and a linked table, JSON and CSV export. | [Open](https://larswpettersson.github.io/hfa-hta/HTA.html) · [offline file](https://larswpettersson.github.io/hfa-hta/hta_offline.html) · [repository](https://github.com/larswpettersson/hfa-hta) |
| **Bowtie *(this repository)*** | Bowtie diagrams: causes, preventive and reactive barriers, top event and consequences, with printing to one A4 page. | [Open](https://larswpettersson.github.io/hfa-bowtie/Bowtie.html) · [offline file](https://larswpettersson.github.io/hfa-bowtie/Bowtie_offline.html) · [repository](https://github.com/larswpettersson/hfa-bowtie) |
| **STPA Workbench** | System-Theoretic Process Analysis: a control-structure diagram built directly in the diagram, tables for losses, hazards, unsafe control actions and safety constraints, and optional AI support. | [Open](https://larswpettersson.github.io/hfa-stpa/workbench/) · [offline file](https://larswpettersson.github.io/hfa-stpa/workbench/stpa_offline.html) · [repository](https://github.com/larswpettersson/hfa-stpa) |
| **RBD (Reliability Block Diagram)** | Reliability block diagrams. Early design stage, not runnable yet. | [repository](https://github.com/larswpettersson/hfa-rbd) |
| **HFA DS** | The design system: design tokens, the Penpot library, the design principles and the shared automated tests. Contains no runnable application. | [repository](https://github.com/larswpettersson/hfa-ds) · [architecture](https://github.com/larswpettersson/hfa-ds/blob/main/docs/ARCHITECTURE.md) · [design principles](https://github.com/larswpettersson/hfa-ds/blob/main/docs/design-principles.md) |

The AI support in the tools is optional. With a local model (Ollama, LM Studio, LocalAI) no data leaves the computer; a cloud provider (Claude, Gemini, Hugging Face) receives the analysis and any attached image. The full picture is in the [architecture](https://github.com/larswpettersson/hfa-ds/blob/main/docs/ARCHITECTURE.md).

## Offline use

The editor also runs fully offline. [`Bowtie_offline.html`](https://larswpettersson.github.io/hfa-bowtie/Bowtie_offline.html) is a single self-contained HTML file (script inlined, no network needed). **[Download Bowtie_offline.html](https://larswpettersson.github.io/hfa-bowtie/Bowtie_offline.html)** (right-click → *Save link as…*), then open the saved file in any modern browser. **New** replaces the diagram with a small, generic example (it asks first). **Open…** asks first if there are unsaved changes (Save, Don't save, Cancel). **Open…** and **Save** use a local file picker and a download; preferences are kept in `localStorage`.


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
  - `A` - AI analysis panel
  - `Ctrl/⌘+Z` - Undo (also the **Undo** button)
  - `Ctrl/⌘+Shift+Z` or `Ctrl+Y` - Redo
- **Undo and redo**: every change is a step, as in HTA and the STPA workbench (up to 100 steps). **New** and a proposal applied from the AI panel can be undone; opening a file starts a new history. In a text field Ctrl/⌘+Z is the field's own undo
- **Inline Editing**: Click any node to edit text inline
- **Barrier Mapping**: Select barriers and click causes/consequences to reassign coverage
- **Several barriers**: Shift+click barriers to select several (as in the STPA workbench) and move them together with Alt/Option + ← / →; Esc clears the selection
- **No overlaps**: barriers in one column never cover the same row. A barrier that would collide (after a move, a new link or a moved card) gets a column of its own right after; empty columns are dropped
- **Responsive**: Works on desktop and mobile browsers

## AI analysis

Press **AI…** in the toolbar (or **A**) to open the analysis panel on the right. It works the same way as the AI analysis in the [STPA workbench](https://larswpettersson.github.io/hfa-stpa/workbench/):

- **Providers:** Anthropic Claude, Google Gemini, Hugging Face Inference Providers (an `hf_…` token; default model `google/gemma-4-31B-it`), or a local model (Ollama, LM Studio, LocalAI). Pick one under **Settings…** and paste an API key or token (or check the local endpoint). Hugging Face setup and the Space that hosts the tools: [hfa-ds/docs/hugging-face.md](https://github.com/larswpettersson/hfa-ds/blob/main/docs/hugging-face.md). The picker beside **Send** chooses the model for the next question.
- **Context:** every question sends the bowtie in a compact form: hazard, top event, causes, consequences, and each barrier with its strength, status and the cause or consequence ids it protects. Select cards (or a barrier) to focus the question on them.
- **Quick actions** for common questions; **Send earlier turns** for follow-ups; answers fold, and **Export .md** saves the conversation.
- **Proposals:** when the model returns a JSON block with a patch (or a complete analysis), the answer shows **Apply**. **Revert** on the card restores what was there before.
- **Keys** stay in this browser's `localStorage` (only when *Remember API keys* is ticked) and are sent only to the provider you pick. The provider settings are shared by the HFA tools on the same site, so a key saved in the STPA workbench is used here too. Use a restricted key.

The panel is [`scripts/ai-assist.js`](scripts/ai-assist.js) (the same file in hfa-hta and hfa-bowtie) and the bowtie adapter is [`scripts/bowtie-ai.js`](scripts/bowtie-ai.js): system prompt, quick actions, the data sent to the model and how a patch is applied. The offline file includes both; it needs network access only for the AI calls.

A patch can change the hazard and top event and add, change or remove causes, consequences and barriers by id. Existing cards keep their order and barriers keep their column where it still fits; new barriers are placed in the next free column. A barrier whose every path is removed goes too.

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
- **Typography:** Open Sans via the `font.family.base` token
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

## License

[MIT](LICENSE) © 2026 Lars Pettersson
