/*
  Bowtie adapter for the HFA AI assistant (scripts/ai-assist.js).
  The model sees a compact bowtie (hazard, top event, causes, consequences and barriers with the card ids they
  protect) instead of the layout state, and answers with the same compact form: a complete bowtie or a patch.
  Applying converts it back to the editor state: existing cards keep their rows and barriers their columns where
  they still fit; new elements are added at the end, as the toolbar does.
*/
(function () {
  "use strict";
  const editor = window.BowtieEditor;
  if (!editor || !window.HFAAssist) return;

  const STATUSES = ["Implemented", "Partly Implemented", "Not Implemented", "To be implemented", "Unknown"];
  const STRENGTHS = ["Normal", "Strong", "Weak"];

  const SYSTEM_PROMPT = `You are an expert safety analyst applying the bowtie method (barrier-based risk analysis, as in CCPS/EI "Bow Ties in Risk Management") to the bowtie supplied as JSON.

Method:
1. Hazard and top event: the hazard is the source of harm in normal operation; the top event is the moment control over it is lost. Check that the top event is a loss of control, not a cause or a consequence.
2. Threats (causes) on the left lead to the top event; consequences on the right follow from it. Check that each is specific, independent and credible, and point out missing ones.
3. Barriers: preventive barriers (left) stop a cause from reaching the top event; recovery barriers (right, called reactive barriers in the editor) stop the top event from escalating into a consequence. A barrier must be effective, independent and auditable (detect – decide – act); an activity, a procedure that is only a hope, or a cause written as a barrier does not count. Assess each barrier's strength (Strong / Normal / Weak) and implementation status, and look for common-mode failure where one barrier element appears on several paths.
4. Escalation factors that degrade barriers and their controls, and the human factors in barriers that rely on people (workload, training, alarm handling, communication).

Rules:
- Reference elements by their ids (C1, K2, P3, R1). Do not invent elements without labelling them "proposed".
- Prefer Markdown tables: for barriers use Barrier | Protects | Type | Strength | Status | Assessment.
- Be concise and specific; state uncertainty instead of guessing.
- Answer in the language of the user's question; keep the diagram text in the language it is written in.`;

  const SCHEMA_PROMPT = `

Data model (compact form of the diagram):
{ "hazard": {"id": "HZ", "label": "…"}, "topEvent": {"id": "TE", "label": "…"},
  "causes":        [{"id": "C1", "description": "…"}],
  "preventiveBarriers": [{"id": "P1", "description": "…", "protects": ["C1", "C2"], "strength": "Normal", "status": "Implemented"}],
  "consequences":  [{"id": "K1", "description": "…"}],
  "reactiveBarriers":   [{"id": "R1", "description": "…", "protects": ["K1"], "strength": "Strong", "status": "Unknown"}] }
Causes and consequences are listed top to bottom. Preventive barriers are listed from the causes toward the top event; reactive (recovery) barriers from the top event toward the consequences. "protects" lists the cause ids (preventive) or consequence ids (reactive) whose path the barrier sits on.
strength is one of ${STRENGTHS.join(", ")}; status is one of ${STATUSES.join(", ")}.

Changing the diagram: unless the user explicitly asks for the complete bowtie, do NOT repeat unchanged elements. Return one \`\`\`json block that is a patch:
{"patch": true, "topEvent": {"label": "…"},
 "causes": [{"id": "C5", "description": "…"}],
 "preventiveBarriers": [{"id": "P2", "status": "Partly Implemented"}, {"id": "P6", "description": "…", "protects": ["C5"], "strength": "Normal", "status": "To be implemented"}],
 "remove": ["K3", "R2"]}
Ids in "remove" (cards or barriers) are deleted first. Then an element whose id exists is merged (only the fields you give change) and a new id is added at the end of its list. Cause ids start with C, consequence ids with K, preventive barrier ids with P and reactive barrier ids with R; give new elements ids that are not used yet.
For a complete bowtie give the compact form without "patch".`;

  const QUICK_ACTIONS = [
    ["Review bowtie", "Review the bowtie: is the top event a loss of control, are the hazard, causes and consequences specific and complete? Point out problems and propose a patch."],
    ["Assess barriers", "Assess every barrier: is it a real barrier (effective, independent, auditable), is the strength and status plausible, and is it on the right paths? Use a table, then propose corrections as a patch."],
    ["Missing barriers", "Find causes and consequences with too few or only weak barriers, and propose additional barriers as a patch (new ids, status \"To be implemented\")."],
    ["Common-mode failure", "Look for common-mode failure: barriers or barrier elements that appear on several paths, or that depend on the same person, system or procedure. Explain the risk and how to reduce it."],
    ["Escalation factors", "For the most important barriers, list escalation factors that could degrade them and the controls that would keep them effective."],
    ["Human factors", "Which barriers rely on human action? For each, assess the human factors (workload, time, training, alarms, communication, procedures) and how the barrier could fail."],
  ];

  /* ── State ↔ compact form ── */
  const tagToId = (idTagId) => String(idTagId).replace(/^id-/, "");
  const byRow = (a, b) => a.row - b.row;
  const barrierOut = (b) => ({ id: b.id, description: b.description, protects: b.protects.map(tagToId), strength: b.strength, status: b.status });
  const byCol = (a, b) => a.col - b.col || (a.authoredSegments?.[0]?.row ?? 0) - (b.authoredSegments?.[0]?.row ?? 0);
  function toCompact(s) {
    return {
      hazard: { id: s.hazard.id, label: s.hazard.label },
      topEvent: { id: s.topEvent.id, label: s.topEvent.label },
      causes: [...s.left.causes].sort(byRow).map((c) => ({ id: c.id, description: c.description })),
      preventiveBarriers: [...s.left.barriers].sort(byCol).map(barrierOut),
      consequences: [...s.right.consequences].sort(byRow).map((c) => ({ id: c.id, description: c.description })),
      reactiveBarriers: [...s.right.barriers].sort(byCol).map(barrierOut),
    };
  }
  const getContext = () => toCompact(editor.getState());

  function getScope() {
    const sel = editor.getSelection();
    const c = getContext();
    const all = { causes: c.causes, consequences: c.consequences, preventiveBarriers: c.preventiveBarriers, reactiveBarriers: c.reactiveBarriers };
    const picked = {}, ids = [];
    const pick = (k, item) => { (picked[k] ||= []).push(item); ids.push(item.id); };
    const wanted = new Set(sel.ids.map((d) => d.replace(/^c-/, "")));
    if (sel.barrierId) wanted.add(String(sel.barrierId).toUpperCase());
    Object.entries(all).forEach(([k, list]) => list.forEach((item) => { if (wanted.has(item.id) || (sel.barrierId && item.id.toLowerCase() === sel.barrierId)) pick(k, item); }));
    if (sel.ids.includes("hazard")) { picked.hazard = c.hazard; ids.push(c.hazard.id); }
    if (sel.ids.includes("top-event")) { picked.topEvent = c.topEvent; ids.push(c.topEvent.id); }
    return ids.length ? { label: ids.join(", "), items: picked } : null;
  }

  /* ── Compact form → editor state ── */
  const fixStrength = (v, d = "Normal") => STRENGTHS.find((x) => x.toLowerCase() === String(v || "").toLowerCase()) || d;
  const fixStatus = (v, d = "Unknown") => STATUSES.find((x) => x.toLowerCase() === String(v || "").toLowerCase()) || d;
  const seqOf = (prefix, ids) => ids.reduce((m, id) => { const hit = new RegExp(`^${prefix}(\\d+)$`, "i").exec(id); return hit ? Math.max(m, +hit[1]) : m; }, 0);

  /** Lay out one side: rows follow the card order; barriers keep a valid column of their own, others are packed in
      list order (the next barrier shares the last column when its rows don't overlap, else opens a new one). */
  function layoutSide(side, cards, barriers, isLeft, topEventId) {
    cards.forEach((c, i) => {
      c.row = i + 1; c.domId = `c-${c.id}`; c.idTagId = `id-${c.id}`; c.connectorTarget = `id-${topEventId}`;
    });
    const rowOf = new Map(cards.map((c) => [c.idTagId, c.row]));
    const valid = new Set(rowOf.keys());
    barriers.forEach((b) => {
      b.protects = [...new Set(b.protects)].filter((t) => valid.has(t)).sort((x, y) => rowOf.get(x) - rowOf.get(y));
      if (!b.protects.length) b.protects = cards.map((c) => c.idTagId); // unlinked: guard every path on this side
      b.everLinked = true;
      b.rows = new Set(b.protects.map((t) => rowOf.get(t)));
    });
    const first = isLeft ? 2 : 1;
    const cols = []; // cols[i] = rows taken in column first + i
    const fits = (i, rows) => ![...rows].some((r) => cols[i].has(r));
    // Barriers that already have a column keep it if it is still free.
    const placed = new Set();
    barriers.filter((b) => Number.isInteger(b.keepCol)).sort((a, b) => a.keepCol - b.keepCol).forEach((b) => {
      const i = b.keepCol - first;
      if (i < 0) return;
      while (cols.length <= i) cols.push(new Set());
      if (fits(i, b.rows)) { b.rows.forEach((r) => cols[i].add(r)); b.col = b.keepCol; placed.add(b); }
    });
    barriers.forEach((b) => {
      if (placed.has(b)) return;
      let i = cols.length - 1;
      if (i < 0 || !fits(i, b.rows)) { cols.push(new Set()); i = cols.length - 1; }
      b.rows.forEach((r) => cols[i].add(r));
      b.col = first + i;
    });
    // Drop empty columns.
    const used = [...new Set(barriers.map((b) => b.col))].sort((a, b) => a - b);
    barriers.forEach((b) => { b.col = first + used.indexOf(b.col); delete b.rows; delete b.keepCol; b.authoredSegments = [{ row: 1, rowSpan: 1 }]; });
    side.rows = Math.max(cards.length, 1);
    side.barrierCols = used.length;
  }

  function toState(c, base) {
    const s = JSON.parse(JSON.stringify(base));
    s.hazard = { id: c.hazard?.id || s.hazard.id, label: String(c.hazard?.label ?? s.hazard.label) };
    s.topEvent = { id: c.topEvent?.id || s.topEvent.id, label: String(c.topEvent?.label ?? s.topEvent.label) };
    const card = (x) => ({ id: String(x.id), description: String(x.description ?? "") });
    const barrier = (x) => ({ barrierId: String(x.id).toLowerCase(), id: String(x.id), description: String(x.description ?? ""),
      strength: fixStrength(x.strength), status: fixStatus(x.status), protects: (x.protects || []).map((id) => `id-${id}`),
      keepCol: Number.isInteger(x.col) ? x.col : undefined });
    s.left.causes = (c.causes || []).map(card);
    s.right.consequences = (c.consequences || []).map(card);
    s.left.barriers = (c.preventiveBarriers || []).map(barrier);
    s.right.barriers = (c.reactiveBarriers || []).map(barrier);
    layoutSide(s.left, s.left.causes, s.left.barriers, true, s.topEvent.id);
    layoutSide(s.right, s.right.consequences, s.right.barriers, false, s.topEvent.id);
    const seq = s.meta.seq || {};
    s.meta.seq = {
      cause: Math.max(seq.cause || 0, seqOf("C", s.left.causes.map((x) => x.id))),
      consequence: Math.max(seq.consequence || 0, seqOf("K", s.right.consequences.map((x) => x.id))),
      preventiveBarrier: Math.max(seq.preventiveBarrier || 0, seqOf("P", s.left.barriers.map((x) => x.id))),
      reactiveBarrier: Math.max(seq.reactiveBarrier || 0, seqOf("R", s.right.barriers.map((x) => x.id))),
    };
    return s;
  }

  /** Merge a patch into the compact form of the current state. Existing barriers carry their column as "col". */
  function applyPatch(state, patch) {
    const c = toCompact(state);
    const colOf = new Map([...state.left.barriers, ...state.right.barriers].map((b) => [b.id, b.col]));
    ["preventiveBarriers", "reactiveBarriers"].forEach((k) => c[k].forEach((b) => { b.col = colOf.get(b.id); }));
    const stats = { added: 0, changed: 0, removed: 0 };
    const LISTS = ["causes", "consequences", "preventiveBarriers", "reactiveBarriers"];
    const PREFIX = { causes: "C", consequences: "K", preventiveBarriers: "P", reactiveBarriers: "R" };
    const allIds = () => new Set(LISTS.flatMap((k) => c[k].map((x) => x.id)));

    const gone = new Set((Array.isArray(patch.remove) ? patch.remove : []).map(String));
    LISTS.forEach((k) => {
      const before = c[k].length;
      c[k] = c[k].filter((x) => !gone.has(x.id));
      stats.removed += before - c[k].length;
    });
    // A barrier whose every path was removed would sit on no path: it goes too.
    stats.dropped = [];
    ["preventiveBarriers", "reactiveBarriers"].forEach((k) => {
      c[k] = c[k].filter((b) => {
        const had = b.protects.length;
        b.protects = b.protects.filter((id) => !gone.has(id));
        if (had && !b.protects.length) { stats.dropped.push(b.id); stats.removed++; return false; }
        return true;
      });
    });

    ["hazard", "topEvent"].forEach((k) => {
      if (patch[k] && typeof patch[k] === "object" && patch[k].label != null) { c[k].label = String(patch[k].label); stats.changed++; }
    });
    LISTS.forEach((k) => {
      (Array.isArray(patch[k]) ? patch[k] : []).forEach((x) => {
        if (!x || typeof x !== "object") return;
        const hit = x.id != null ? c[k].find((y) => y.id === String(x.id)) : null;
        const fields = { ...x }; delete fields.id; delete fields.col;
        if (hit) {
          if (fields.protects && hit.protects && (fields.protects.length !== hit.protects.length || fields.protects.some((p, i) => p !== hit.protects[i]))) delete hit.col;
          Object.assign(hit, fields); stats.changed++; return;
        }
        const used = allIds();
        let id = x.id != null ? String(x.id) : "";
        if (!id || used.has(id) || !new RegExp(`^${PREFIX[k]}\\d+$`, "i").test(id)) {
          let n = seqOf(PREFIX[k], [...used]) + 1; while (used.has(PREFIX[k] + n)) n++;
          id = PREFIX[k] + n;
        }
        c[k].push({ ...fields, id: id.toUpperCase() });
        stats.added++;
      });
    });
    return { compact: c, stats };
  }

  function inspect(obj) {
    if (obj.patch === true) {
      const n = (k) => (Array.isArray(obj[k]) ? obj[k].length : 0);
      const parts = [["causes", "causes"], ["preventiveBarriers", "preventive barriers"], ["consequences", "consequences"], ["reactiveBarriers", "reactive barriers"]]
        .filter(([k]) => n(k)).map(([k, label]) => `${n(k)} ${label}`);
      if (obj.hazard) parts.push("hazard");
      if (obj.topEvent) parts.push("top event");
      if (n("remove")) parts.push(`remove ${obj.remove.join(", ")}`);
      return { title: `Bowtie patch · ${parts.join(", ") || "no changes"}`, applyLabel: "Apply to diagram" };
    }
    if (Array.isArray(obj.causes) || Array.isArray(obj.consequences)) {
      const n = (k) => (Array.isArray(obj[k]) ? obj[k].length : 0);
      return { title: `Bowtie · ${n("causes")} causes, ${n("preventiveBarriers") + n("reactiveBarriers")} barriers, ${n("consequences")} consequences`,
        applyLabel: "Load into diagram", confirm: "Replace the diagram with this bowtie? (Revert restores the current one; Export first to keep a copy.)" };
    }
    return null;
  }

  function apply(obj) {
    const cur = editor.getState();
    if (obj.patch === true) {
      const { compact, stats } = applyPatch(cur, obj);
      editor.replaceState(toState(compact, cur));
      const dropped = stats.dropped.length ? ` (${stats.dropped.join(", ")} only guarded removed paths and went too)` : "";
      return `Patch applied: ${stats.added} added, ${stats.changed} changed, ${stats.removed} removed${dropped}.`;
    }
    editor.replaceState(toState(obj, cur));
    return "Bowtie loaded.";
  }

  window.BowtieAssist = HFAAssist.mount({
    id: "bowtie",
    title: "Bowtie analysis",
    toolbar: document.querySelector(".toolbar"),
    buttonClass: "action-btn",
    systemPrompt: SYSTEM_PROMPT,
    schemaPrompt: SCHEMA_PROMPT,
    contextLabel: "Current bowtie (JSON, compact form)",
    getContext,
    getScope,
    quickActions: QUICK_ACTIONS,
    inspect,
    apply,
    snapshot: () => editor.getState(),
    restore: (snap) => editor.replaceState(snap),
    welcome: "Pick a provider in **Settings**, then use a quick action or ask a question. The bowtie is sent with every request; select cards or a barrier to focus on them.",
    exportName: "bowtie-analysis",
  });
  Object.assign(window.BowtieAssist, { applyPatch, toState, toCompact });
})();
