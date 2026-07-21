# Component migration (Penpot UI)

MCP cannot copy components across Penpot files. After running `01-import-bowtie-tokens.js` on **HFA DS**, complete these steps in the Penpot UI.

## 1. HFA DS — copy components onto `Components` page

| Source file | Components to copy |
|---|---|
| **Bowtie** | Card, Barrier, Hazard, TopEvent, Consequence, Toolbar, Action Button, Legend, Legend state, Legend strength, Connector (variant containers) |
| **HTA** | Task, Connector Orthogonal |
| **STPA** | Note |

For each: open source file → `Components` page → select variant container → Copy → open **HFA DS** → `Components` → Paste → confirm still a **main component**.

Restyle HTA/STPA components with Bowtie tokens (`background.elevated`, `foreground`, `normal`, `roboto-base`, `size.normal`).

## 2. Publish HFA DS library

In **HFA DS**: enable **Share as library** / publish so other files see components in Assets → Libraries.

## 3. Rewire consumer files

For **Bowtie**, **RBD**, **HTA**, **STPA**:

1. Assets → Libraries → connect **HFA DS**
2. Replace local instances with HFA DS library instances
3. Delete local main components (after all instances swapped)
4. **Bowtie**: stop publishing Bowtie as a library
5. Disconnect obsolete library links (Bowtie as source, STPA self-library)

## 4. Run orchestrator per file

Connect each file to MCP and paste `00-orchestrator.js` into execute_code to import tokens and list remaining mains.
