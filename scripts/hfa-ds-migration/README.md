# HFA DS Penpot migration scripts

Run via **Penpot MCP → execute_code** with the indicated file connected (File → MCP Server → Connect).

| Order | Script | Connect file |
|---|---|---|
| 0 | `00-orchestrator.js` | **HFA DS** first, then Bowtie → HTA → STPA → RBD |
| 1 | `01-import-bowtie-tokens.js` | Same (tokens only) |
| 2 | `02-component-migration.md` | Manual UI steps for components + library publish |

**Completed automatically (MCP):** token import pattern, Source Sans 3 on `roboto-base`, STPA Note token/font styling when STPA is connected.

**Requires Penpot UI:** copying components into HFA DS, publishing library, swapping instances in app files.

**Rollback:** History → `"Pre Assets and tokens refactoring"`.
