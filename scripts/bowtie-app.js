(function () {
  const bowtie = document.getElementById("bowtie");
  const bowtieWrap = document.querySelector(".bowtie-wrap");
  const zoneLeft = document.getElementById("zone-left");
  const zoneCenter = document.getElementById("zone-center");
  const zoneRight = document.getElementById("zone-right");
  const connectorsSvg = bowtie.querySelector(".connectors-svg");

  let spacePanArmed = false;
  let isPanning = false;
  let panLast = { x: 0, y: 0 };
  let ignoreClickAfterPan = false;

  let state = null;
  const ui = { activeBarrierId: null, selectedIds: new Set(), selectionAnchorId: null };
  let selectedFocusDomId = null;
  let editSession = null;
  let blurNavigation = null; // 'tab' | 'apply' | 'cancel'
  let linkModeSnapshot = null; // { barrierId, protects, everLinked, barrierCols }
  let selectionLayoutSnapshot = null; // { side, rows }
  let selectionLayoutDirty = false;

  const connectors = [];

  // ---------- Text helpers ----------

  function truncateDescription(description) {
    return description.length > 200 ? description.substring(0, 200) + "..." : description;
  }

  function readEditableText(el) {
    return (el.innerText ?? el.textContent ?? "").replace(/\r\n?/g, "\n");
  }

  function writeEditableText(el, text) {
    el.textContent = text;
  }

  function applyDescriptionTruncation(el, full) {
    const value = full ?? el.dataset.full ?? readEditableText(el);
    el.dataset.full = value;
    writeEditableText(el, truncateDescription(value));
  }

  function fitBarrierDescription(el, { respectFocus = true } = {}) {
    if (!el || !el.closest(".barrier")) return;
    if (respectFocus && el === document.activeElement) return;
    const capped = truncateDescription(el.dataset.full || readEditableText(el));
    writeEditableText(el, capped);
    if (el.scrollHeight <= el.clientHeight + 1) return;

    let lo = 0;
    let hi = capped.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      writeEditableText(el, capped.slice(0, mid).trimEnd() + "…");
      if (el.scrollHeight <= el.clientHeight + 1) lo = mid;
      else hi = mid - 1;
    }
    writeEditableText(el, lo > 0 ? capped.slice(0, lo).trimEnd() + "…" : "…");
  }

  function fitAllBarrierDescriptions() {
    document.querySelectorAll(".barrier .desc-text").forEach((el) => fitBarrierDescription(el));
  }

  // ---------- Grid placement ----------

  function applyPlacement(el, row, col, rowSpan) {
    const r = row ?? Number(el.dataset.row || 1);
    const c = col ?? Number(el.dataset.col || 1);
    const span = rowSpan ?? Number(el.dataset.rowSpan || 1);
    el.dataset.row = String(r);
    el.dataset.col = String(c);
    el.dataset.rowSpan = String(span);
    el.style.gridRow = span > 1 ? `${r} / span ${span}` : String(r);
    el.style.gridColumn = String(c);
  }

  function rebuildLeftGrid(left) {
    zoneLeft.style.gridTemplateRows = `repeat(${left.rows}, 1fr)`;
    zoneLeft.style.gridTemplateColumns =
      `minmax(200px, 1fr) ${"var(--barrier-width) ".repeat(left.barrierCols)}`.trim();
  }

  function rebuildRightGrid(right) {
    zoneRight.style.gridTemplateRows = `repeat(${right.rows}, 1fr)`;
    zoneRight.style.gridTemplateColumns =
      `${"var(--barrier-width) ".repeat(right.barrierCols)}minmax(200px, 1fr)`.trim();
  }

  // ---------- Pure layout ----------

  function computeContiguousRuns(sortedRows) {
    const runs = [];
    let start = null;
    let prev = null;
    sortedRows.forEach((row) => {
      if (start === null) {
        start = row;
      } else if (row !== prev + 1) {
        runs.push([start, prev]);
        start = row;
      }
      prev = row;
    });
    if (start !== null) runs.push([start, prev]);
    return runs;
  }

  function computeBarrierSegments(barrier, leaves) {
    if (!barrier.everLinked) {
      return barrier.authoredSegments.map((seg) => ({ ...seg }));
    }

    const rows = [
      ...new Set(
        barrier.protects
          .map((idTagId) => leaves.find((leaf) => leaf.idTagId === idTagId))
          .filter(Boolean)
          .map((leaf) => leaf.row)
      ),
    ].sort((a, b) => a - b);

    if (!rows.length) {
      return [{ row: 1, rowSpan: 1 }];
    }

    return computeContiguousRuns(rows).map(([start, end]) => ({
      row: start,
      rowSpan: end - start + 1,
    }));
  }

  function segmentsForRender(barrier, leaves) {
    if (ui.activeBarrierId === barrier.barrierId) {
      return barrier.authoredSegments.map((seg) => ({ ...seg }));
    }
    return computeBarrierSegments(barrier, leaves);
  }

  // ---------- Hydrate (inferProtectionsFromRows lives here only) ----------

  function inferProtectionsFromRows(segments, zone, kind) {
    const rows = new Set();
    segments.forEach((seg) => {
      for (let r = seg.row; r < seg.row + seg.rowSpan; r++) rows.add(r);
    });

    return Array.from(rows)
      .map((row) => zone.querySelector(`.card[data-kind="${kind}"][data-row="${row}"]`))
      .filter(Boolean)
      .map((card) => card.querySelector('[data-role="id"]'))
      .filter(Boolean)
      .map((idTag) => idTag.id);
  }

  function inferProtectionsFromLeaves(segments, leaves) {
    const rows = new Set();
    segments.forEach((seg) => {
      for (let r = seg.row; r < seg.row + seg.rowSpan; r++) rows.add(r);
    });
    return Array.from(rows)
      .map((row) => leaves.find((leaf) => leaf.row === row))
      .filter(Boolean)
      .map((leaf) => leaf.idTagId);
  }

  function parseCard(cardEl, kind) {
    const idTag = cardEl.querySelector('[data-role="id"]');
    const desc = cardEl.querySelector('[data-role="description"]');
    const id = idTag ? readEditableText(idTag) : cardEl.id.replace(/^c-/, "");
    return {
      id,
      domId: cardEl.id,
      idTagId: idTag ? idTag.id : `id-${id}`,
      description: desc ? readEditableText(desc) : "",
      row: Number(cardEl.dataset.row || 1),
      connectorTarget: idTag?.dataset.target || "id-TE",
    };
  }

  function parseBarrierGroup(segments, zone, kind) {
    segments.sort(
      (a, b) =>
        Number(a.dataset.row) - Number(b.dataset.row) ||
        Number(a.dataset.col) - Number(b.dataset.col)
    );
    const primary = segments[0];
    const idTag = primary.querySelector('[data-role="id"]');
    const desc = primary.querySelector('[data-role="description"]');
    const barrierId = primary.dataset.barrierId || primary.id.replace(/^b-/, "");
    const everLinked = segments.some((seg) => seg.dataset.protects !== undefined);

    const authoredSegments = segments.map((seg) => ({
      row: Number(seg.dataset.row),
      rowSpan: Number(seg.dataset.rowSpan || 1),
      domId: seg.id,
      idTagId: seg.querySelector('[data-role="id"]')?.id,
    }));

    let protects = everLinked
      ? (primary.dataset.protects || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : inferProtectionsFromRows(authoredSegments, zone, kind);

    return {
      barrierId,
      id: idTag ? readEditableText(idTag) : barrierId.toUpperCase(),
      description: desc ? readEditableText(desc) : "",
      col: Number(primary.dataset.col),
      strength: primary.dataset.strength || "Normal",
      status: primary.dataset.status || "Unknown",
      protects,
      everLinked,
      authoredSegments,
    };
  }

  function hydrateBarriers(zone, kind) {
    const groups = new Map();
    zone.querySelectorAll(".barrier").forEach((seg) => {
      const barrierId = seg.dataset.barrierId || seg.id.replace(/^b-/, "");
      if (!groups.has(barrierId)) groups.set(barrierId, []);
      groups.get(barrierId).push(seg);
    });
    return Array.from(groups.values()).map((segments) => parseBarrierGroup(segments, zone, kind));
  }

  function maxSeqFromIds(prefix, items) {
    let max = 0;
    items.forEach((item) => {
      const match = item.id.match(new RegExp(`^${prefix}(\\d+)$`, "i"));
      if (match) max = Math.max(max, Number(match[1]));
    });
    return max;
  }

  function hydrateFromDom() {
    const causes = Array.from(zoneLeft.querySelectorAll('.card[data-kind="cause"]')).map((el) =>
      parseCard(el, "cause")
    );
    const consequences = Array.from(zoneRight.querySelectorAll('.card[data-kind="consequence"]')).map(
      (el) => parseCard(el, "consequence")
    );
    const leftBarriers = hydrateBarriers(zoneLeft, "cause");
    const rightBarriers = hydrateBarriers(zoneRight, "consequence");

    const leftRows = causes.length ? Math.max(...causes.map((c) => c.row)) : 1;
    const rightRows = consequences.length ? Math.max(...consequences.map((c) => c.row)) : 1;
    const leftBarrierCols = leftBarriers.length
      ? Math.max(...leftBarriers.map((b) => b.col)) - 1
      : 0;
    const rightBarrierCols = rightBarriers.length
      ? Math.max(...rightBarriers.map((b) => b.col))
      : 0;

    const hazardRoot = document.querySelector(".hazard");
    const topEventRoot = document.querySelector(".top-event");
    const hazardDesc = hazardRoot?.querySelector('[data-role="description"]');
    const topEventDesc = topEventRoot?.querySelector('[data-role="description"]');
    const hazardIdEl = hazardRoot?.querySelector("[id^='id-']") || document.getElementById("id-HZ");
    const topEventIdEl = topEventRoot?.querySelector("[id^='id-']") || document.getElementById("id-TE");

    return {
      meta: {
        theme: document.body.dataset.theme || "light",
        seq: {
          cause: maxSeqFromIds("C", causes),
          preventiveBarrier: maxSeqFromIds("P", leftBarriers),
          reactiveBarrier: maxSeqFromIds("R", rightBarriers),
          consequence: maxSeqFromIds("K", consequences),
        },
      },
      hazard: {
        id: hazardIdEl?.id?.replace(/^id-/, "") || "HZ",
        label: hazardDesc ? readEditableText(hazardDesc) : "",
      },
      topEvent: {
        id: topEventIdEl?.id?.replace(/^id-/, "") || "TE",
        label: topEventDesc ? readEditableText(topEventDesc) : "",
      },
      left: {
        rows: Math.max(leftRows, 1),
        barrierCols: Math.max(leftBarrierCols, 0),
        causes,
        barriers: leftBarriers,
      },
      right: {
        rows: Math.max(rightRows, 1),
        barrierCols: Math.max(rightBarrierCols, 0),
        consequences,
        barriers: rightBarriers,
      },
    };
  }

  // ---------- Validation ----------

  // Left grid: col 1 = causes; preventive barriers use col 2 .. (1 + barrierCols).
  // Right grid: reactive barriers use col 1 .. barrierCols; consequences use barrierCols + 1.
  // Common LLM mistake: preventive barrier at col 1 (Gemini traffic-event fixture) — it lands in
  // the causes column, renders disconnected at the far left, and skips connector routing.

  function validateImportState(s) {
    const errors = [];
    const warnings = [];

    const pushError = (path, message, fix) => {
      errors.push({ path, message, fix });
    };
    const pushWarning = (path, message, fix) => {
      warnings.push({ path, message, fix });
    };

    if (!s.hazard?.id) pushError("hazard.id", "Hazard id is required.", 'Set hazard.id (e.g. "HZ").');
    if (!s.topEvent?.id) {
      pushError("topEvent.id", "Top event id is required.", 'Set topEvent.id (e.g. "TE").');
    }

    const topEventIdTag = s.topEvent?.id ? `id-${s.topEvent.id}` : null;

    s.left.causes.forEach((c, index) => {
      const path = `left.causes[${index}]`;
      if (!c.id) pushError(`${path}.id`, "Cause missing id.", "Add a unique id such as C1.");
      if (c.row < 1 || c.row > s.left.rows) {
        pushError(
          `${path} (${c.id || "?"}).row`,
          `Row ${c.row} is outside left.rows (1..${s.left.rows}).`,
          `Set row between 1 and ${s.left.rows}, or increase left.rows.`
        );
      }
      if (topEventIdTag && c.connectorTarget && c.connectorTarget !== topEventIdTag) {
        pushWarning(
          `${path} (${c.id}).connectorTarget`,
          `connectorTarget is "${c.connectorTarget}" but top event is "${topEventIdTag}".`,
          `Set connectorTarget to "${topEventIdTag}".`
        );
      }
    });

    s.right.consequences.forEach((c, index) => {
      const path = `right.consequences[${index}]`;
      if (!c.id) pushError(`${path}.id`, "Consequence missing id.", "Add a unique id such as K1.");
      if (c.row < 1 || c.row > s.right.rows) {
        pushError(
          `${path} (${c.id || "?"}).row`,
          `Row ${c.row} is outside right.rows (1..${s.right.rows}).`,
          `Set row between 1 and ${s.right.rows}, or increase right.rows.`
        );
      }
    });

    const leafIdTagIds = new Set([
      ...s.left.causes.map((c) => c.idTagId),
      ...s.right.consequences.map((c) => c.idTagId),
    ]);

    const leftMaxCol = s.left.barrierCols + 1;
    const seenLeftBarrierIds = new Map();
    s.left.barriers.forEach((b, index) => {
      const path = `left.barriers[${index}]`;
      const label = b.id || b.barrierId || "?";

      if (!b.barrierId) {
        pushError(`${path}.barrierId`, "Preventive barrier missing barrierId.", 'Add barrierId (e.g. "p1").');
      } else if (seenLeftBarrierIds.has(b.barrierId)) {
        pushError(
          `${path}.barrierId`,
          `Duplicate barrierId "${b.barrierId}" on the left side (also at index ${seenLeftBarrierIds.get(b.barrierId)}).`,
          "Use one barrier object per barrierId; merge authoredSegments instead of splitting."
        );
      } else {
        seenLeftBarrierIds.set(b.barrierId, index);
      }

      if (b.col < 2) {
        pushError(
          `${path} (${label}).col`,
          `col=${b.col} is invalid for preventive barrier ${label}: column 1 is reserved for causes.`,
          `Set ${label}.col to 2 for the innermost preventive barrier, 3 for the next column toward the top event, etc. Example: P1 col=2 with protects ["id-C1","id-C2"]; shift any barrier already at col>=2 one column right.`
        );
      } else if (b.col > leftMaxCol) {
        pushError(
          `${path} (${label}).col`,
          `col=${b.col} exceeds the left grid (max ${leftMaxCol} when left.barrierCols=${s.left.barrierCols}).`,
          `Increase left.barrierCols to at least ${b.col - 1}, or reduce ${label}.col.`
        );
      }

      if (b.everLinked && b.protects.length === 0) {
        pushError(
          `${path} (${label}).protects`,
          `${label} has everLinked=true but protects is empty — it will render with no cause links.`,
          `Add cause idTagIds to protects (e.g. ["id-C1","id-C2"]) matching linked causes.`
        );
      } else if (!b.everLinked && b.protects.length === 0) {
        pushWarning(
          `${path} (${label}).protects`,
          `${label} has no protects links and everLinked=false.`,
          "Link the barrier to at least one cause via protects, or set everLinked=true once linked."
        );
      }

      b.protects.forEach((idTagId) => {
        if (!leafIdTagIds.has(idTagId)) {
          pushError(
            `${path} (${label}).protects`,
            `Unknown idTagId "${idTagId}" in protects.`,
            `Use idTagId values from left.causes (e.g. id-C1), not domId values like c-C1.`
          );
        }
      });

      (b.authoredSegments || []).forEach((seg, segIndex) => {
        const segPath = `${path}.authoredSegments[${segIndex}]`;
        if (seg.row < 1 || seg.row > s.left.rows) {
          pushError(
            `${segPath}.row`,
            `Segment row ${seg.row} is outside left.rows (1..${s.left.rows}).`,
            `Set row between 1 and ${s.left.rows} for barrier ${label}.`
          );
        }
        if (seg.rowSpan < 1 || seg.row + seg.rowSpan - 1 > s.left.rows) {
          pushError(
            `${segPath}.rowSpan`,
            `Segment rowSpan ${seg.rowSpan} at row ${seg.row} exceeds left.rows (${s.left.rows}).`,
            `Reduce rowSpan or move the segment up so row + rowSpan - 1 <= ${s.left.rows}.`
          );
        }
      });
    });

    const seenRightBarrierIds = new Map();
    s.right.barriers.forEach((b, index) => {
      const path = `right.barriers[${index}]`;
      const label = b.id || b.barrierId || "?";

      if (!b.barrierId) {
        pushError(`${path}.barrierId`, "Reactive barrier missing barrierId.", 'Add barrierId (e.g. "r1").');
      } else if (seenRightBarrierIds.has(b.barrierId)) {
        pushError(
          `${path}.barrierId`,
          `Duplicate barrierId "${b.barrierId}" on the right side (also at index ${seenRightBarrierIds.get(b.barrierId)}).`,
          "Use one barrier object per barrierId; merge authoredSegments instead of splitting."
        );
      } else {
        seenRightBarrierIds.set(b.barrierId, index);
      }

      if (b.col < 1 || b.col > s.right.barrierCols) {
        pushError(
          `${path} (${label}).col`,
          `col=${b.col} is outside the reactive barrier range 1..${s.right.barrierCols}.`,
          `Set ${label}.col between 1 and ${s.right.barrierCols} (consequences occupy col ${s.right.barrierCols + 1}).`
        );
      }

      if (b.everLinked && b.protects.length === 0) {
        pushError(
          `${path} (${label}).protects`,
          `${label} has everLinked=true but protects is empty.`,
          `Add consequence idTagIds to protects (e.g. ["id-K1"]).`
        );
      }

      b.protects.forEach((idTagId) => {
        if (!leafIdTagIds.has(idTagId)) {
          pushError(
            `${path} (${label}).protects`,
            `Unknown idTagId "${idTagId}" in protects.`,
            `Use idTagId values from right.consequences (e.g. id-K1).`
          );
        }
      });

      (b.authoredSegments || []).forEach((seg, segIndex) => {
        const segPath = `${path}.authoredSegments[${segIndex}]`;
        if (seg.row < 1 || seg.row > s.right.rows) {
          pushError(
            `${segPath}.row`,
            `Segment row ${seg.row} is outside right.rows (1..${s.right.rows}).`,
            `Set row between 1 and ${s.right.rows} for barrier ${label}.`
          );
        }
        if (seg.rowSpan < 1 || seg.row + seg.rowSpan - 1 > s.right.rows) {
          pushError(
            `${segPath}.rowSpan`,
            `Segment rowSpan ${seg.rowSpan} at row ${seg.row} exceeds right.rows (${s.right.rows}).`,
            `Reduce rowSpan or move the segment up.`
          );
        }
      });
    });

    const leftCols = s.left.barriers.map((b) => b.col);
    leftCols.forEach((col, index) => {
      if (leftCols.indexOf(col) !== index) {
        const label = s.left.barriers[index].id || s.left.barriers[index].barrierId;
        pushWarning(
          `left.barriers[${index}] (${label}).col`,
          `Multiple preventive barriers share col=${col}.`,
          "Assign unique columns: innermost barrier col=2, next col=3, etc."
        );
      }
    });

    const rightCols = s.right.barriers.map((b) => b.col);
    rightCols.forEach((col, index) => {
      if (rightCols.indexOf(col) !== index) {
        const label = s.right.barriers[index].id || s.right.barriers[index].barrierId;
        pushWarning(
          `right.barriers[${index}] (${label}).col`,
          `Multiple reactive barriers share col=${col}.`,
          "Assign unique columns between 1 and right.barrierCols."
        );
      }
    });

    const requiredLeftBarrierCols = s.left.barriers.length
      ? Math.max(...s.left.barriers.map((b) => b.col)) - 1
      : 0;
    if (Number(s.left.barrierCols) < requiredLeftBarrierCols) {
      pushWarning(
        "left.barrierCols",
        `left.barrierCols=${s.left.barrierCols} is smaller than required ${requiredLeftBarrierCols}.`,
        `Set left.barrierCols to ${requiredLeftBarrierCols}.`
      );
    }

    const requiredRightBarrierCols = s.right.barriers.length
      ? Math.max(...s.right.barriers.map((b) => b.col))
      : 0;
    if (Number(s.right.barrierCols) < requiredRightBarrierCols) {
      pushWarning(
        "right.barrierCols",
        `right.barrierCols=${s.right.barrierCols} is smaller than required ${requiredRightBarrierCols}.`,
        `Set right.barrierCols to ${requiredRightBarrierCols}.`
      );
    }

    const seqChecks = [
      ["cause", "C", s.left.causes, s.meta?.seq?.cause],
      ["consequence", "K", s.right.consequences, s.meta?.seq?.consequence],
      ["preventiveBarrier", "P", s.left.barriers, s.meta?.seq?.preventiveBarrier],
      ["reactiveBarrier", "R", s.right.barriers, s.meta?.seq?.reactiveBarrier],
    ];
    seqChecks.forEach(([seqKey, prefix, items, seqValue]) => {
      const expected = maxSeqFromIds(prefix, items);
      if (seqValue != null && Number(seqValue) !== expected) {
        pushWarning(
          `meta.seq.${seqKey}`,
          `meta.seq.${seqKey}=${seqValue} but highest ${prefix} id is ${prefix}${expected}.`,
          `Set meta.seq.${seqKey} to ${expected}.`
        );
      }
    });

    return { errors, warnings };
  }

  function formatImportValidationMessage(errors, warnings) {
    const lines = [];
    if (errors.length) {
      lines.push(`Import blocked (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
      errors.forEach((item, index) => {
        lines.push(`${index + 1}. [${item.path}] ${item.message}`);
        if (item.fix) lines.push(`   Fix: ${item.fix}`);
      });
    }
    if (warnings.length) {
      if (lines.length) lines.push("");
      lines.push(`${warnings.length} warning${warnings.length === 1 ? "" : "s"}:`);
      warnings.forEach((item, index) => {
        lines.push(`${index + 1}. [${item.path}] ${item.message}`);
        if (item.fix) lines.push(`   Fix: ${item.fix}`);
      });
    }
    return lines.join("\n");
  }

  function validateState(s) {
    const leafIdTagIds = new Set([
      ...s.left.causes.map((c) => c.idTagId),
      ...s.right.consequences.map((c) => c.idTagId),
    ]);
    const centerIds = new Set([`id-${s.hazard.id}`, `id-${s.topEvent.id}`]);

    s.left.causes.forEach((c) => {
      if (!document.getElementById(c.domId) && !c.domId) {
        console.warn(`Cause missing domId: ${c.id}`);
      }
      if (c.row < 1 || c.row > s.left.rows) {
        console.warn(`Cause ${c.id} row ${c.row} out of range 1..${s.left.rows}`);
      }
    });

    s.right.consequences.forEach((c) => {
      if (c.row < 1 || c.row > s.right.rows) {
        console.warn(`Consequence ${c.id} row ${c.row} out of range 1..${s.right.rows}`);
      }
    });

    [...s.left.barriers, ...s.right.barriers].forEach((b) => {
      b.protects.forEach((idTagId) => {
        if (!leafIdTagIds.has(idTagId)) {
          console.warn(`Barrier ${b.barrierId} protects unknown idTagId: ${idTagId}`);
        }
      });
      if (b.col < 1) {
        console.warn(`Barrier ${b.barrierId} has invalid col ${b.col}`);
      }
    });

    if (!centerIds.has(`id-${s.hazard.id}`)) {
      console.warn(`Hazard idTag id-${s.hazard.id} may be missing from DOM`);
    }
    if (!centerIds.has(`id-${s.topEvent.id}`)) {
      console.warn(`TopEvent idTag id-${s.topEvent.id} may be missing from DOM`);
    }
  }

  // ---------- Persist (JSON import/export) ----------

  const DIAGRAM_VERSION = 1;

  function serializeState(source = state) {
    return {
      version: DIAGRAM_VERSION,
      meta: JSON.parse(JSON.stringify(source.meta)),
      hazard: JSON.parse(JSON.stringify(source.hazard)),
      topEvent: JSON.parse(JSON.stringify(source.topEvent)),
      left: JSON.parse(JSON.stringify(source.left)),
      right: JSON.parse(JSON.stringify(source.right)),
    };
  }

  function normalizeImportedState(raw) {
    const s = JSON.parse(JSON.stringify(raw));
    delete s.version;

    s.meta = s.meta || {};
    s.meta.theme = s.meta.theme === "dark" ? "dark" : "light";
    s.meta.seq = s.meta.seq || {};
    s.hazard = s.hazard || { id: "HZ", label: "Hazard" };
    s.topEvent = s.topEvent || { id: "TE", label: "Top Event" };
    s.left = s.left || { rows: 1, barrierCols: 0, causes: [], barriers: [] };
    s.right = s.right || { rows: 1, barrierCols: 0, consequences: [], barriers: [] };
    s.left.causes = s.left.causes || [];
    s.left.barriers = s.left.barriers || [];
    s.right.consequences = s.right.consequences || [];
    s.right.barriers = s.right.barriers || [];

    const normalizeCard = (card) => {
      if (!card.id) throw new Error("Card missing id");
      card.domId = card.domId || `c-${card.id}`;
      card.idTagId = card.idTagId || `id-${card.id}`;
      card.description = card.description ?? "";
      card.row = Number(card.row) || 1;
      card.connectorTarget = card.connectorTarget || `id-${s.topEvent.id}`;
    };

    s.left.causes.forEach(normalizeCard);
    s.right.consequences.forEach(normalizeCard);

    s.left.rows = Math.max(Number(s.left.rows) || 1, ...s.left.causes.map((c) => c.row), 1);
    s.right.rows = Math.max(Number(s.right.rows) || 1, ...s.right.consequences.map((c) => c.row), 1);

    const normalizeBarrier = (barrier, leaves, side) => {
      if (!barrier.barrierId) throw new Error("Barrier missing barrierId");
      barrier.id = barrier.id || String(barrier.barrierId).toUpperCase();
      barrier.description = barrier.description ?? "";
      barrier.col = Number(barrier.col) || (side === "left" ? 2 : 1);
      barrier.strength = barrier.strength || "Normal";
      barrier.status = barrier.status || "Unknown";
      barrier.protects = Array.isArray(barrier.protects) ? [...barrier.protects] : [];
      barrier.everLinked = Boolean(barrier.everLinked || barrier.protects.length);
      barrier.authoredSegments = computeBarrierSegments(barrier, leaves);
    };

    s.left.barriers.forEach((b) => normalizeBarrier(b, s.left.causes, "left"));
    s.right.barriers.forEach((b) => normalizeBarrier(b, s.right.consequences, "right"));

    s.left.barrierCols = Math.max(
      Number(s.left.barrierCols) || 0,
      s.left.barriers.length ? Math.max(...s.left.barriers.map((b) => b.col)) - 1 : 0
    );
    s.right.barrierCols = Math.max(
      Number(s.right.barrierCols) || 0,
      s.right.barriers.length ? Math.max(...s.right.barriers.map((b) => b.col)) : 0
    );

    if (!s.meta.seq.cause) s.meta.seq.cause = maxSeqFromIds("C", s.left.causes);
    if (!s.meta.seq.consequence) s.meta.seq.consequence = maxSeqFromIds("K", s.right.consequences);
    if (!s.meta.seq.preventiveBarrier) {
      s.meta.seq.preventiveBarrier = maxSeqFromIds("P", s.left.barriers);
    }
    if (!s.meta.seq.reactiveBarrier) s.meta.seq.reactiveBarrier = maxSeqFromIds("R", s.right.barriers);

    return s;
  }

  function deserializeState(input) {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid diagram JSON");
    }
    if (!parsed.meta || !parsed.hazard || !parsed.topEvent || !parsed.left || !parsed.right) {
      throw new Error("Diagram JSON missing required fields");
    }
    return normalizeImportedState(parsed);
  }

  function applyState(nextState) {
    clearLinkModeUI(ui.activeBarrierId);
    editSession = null;
    clearComponentSelection();

    state = nextState;
    validateState(state);
    render(state);
    buildConnectors();
    updateTabOrder();
    fitAllBarrierDescriptions();
  }

  function loadState(input) {
    applyState(deserializeState(input));
  }

  function exportStateToFile() {
    const json = JSON.stringify(serializeState(), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bowtie.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function importStateFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const normalized = deserializeState(reader.result);
        const { errors, warnings } = validateImportState(normalized);
        if (errors.length) {
          window.alert(formatImportValidationMessage(errors, warnings));
          return;
        }
        if (warnings.length) {
          const proceed = window.confirm(
            `${formatImportValidationMessage([], warnings)}\n\nImport anyway?`
          );
          if (!proceed) return;
        }
        applyState(normalized);
      } catch (err) {
        console.error(err);
        window.alert(`Import failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  // ---------- State lookups ----------

  function findCause(domId) {
    return state.left.causes.find((c) => c.domId === domId);
  }

  function findConsequence(domId) {
    return state.right.consequences.find((c) => c.domId === domId);
  }

  function findCardByDomId(domId) {
    return findCause(domId) || findConsequence(domId);
  }

  function findBarrier(barrierId, side) {
    const list = side === "left" ? state.left.barriers : state.right.barriers;
    return list.find((b) => b.barrierId === barrierId);
  }

  function barrierSide(barrierId) {
    if (state.left.barriers.some((b) => b.barrierId === barrierId)) return "left";
    if (state.right.barriers.some((b) => b.barrierId === barrierId)) return "right";
    return null;
  }

  function getActiveBarrierState() {
    if (!ui.activeBarrierId) return null;
    const side = barrierSide(ui.activeBarrierId);
    return side ? findBarrier(ui.activeBarrierId, side) : null;
  }

  function getActiveBarrierEl() {
    if (!ui.activeBarrierId) return null;
    return document.querySelector(`.barrier[data-barrier-id="${ui.activeBarrierId}"]`);
  }

  function getBarrierSegmentEls(barrierId) {
    return Array.from(document.querySelectorAll(`.barrier[data-barrier-id="${barrierId}"]`));
  }

  function segmentDomId(barrier, seg, index) {
    if (!barrier.everLinked && seg.domId) return seg.domId;
    return index === 0 ? `b-${barrier.barrierId}` : `b-${barrier.barrierId}--${index}`;
  }

  function segmentIdTagId(barrier, seg, index) {
    if (!barrier.everLinked && seg.idTagId) return seg.idTagId;
    return `id-${barrier.id}${index === 0 ? "" : String.fromCharCode(96 + index)}`;
  }

  // ---------- DOM creation ----------

  function isEditContextSelected(el) {
    const component = el.closest(".card, .barrier, .hazard, .top-event");
    if (!component) return false;
    const domId = domIdForComponent(component);
    if (ui.selectedIds.has(domId)) return true;
    if (selectedFocusDomId === domId) return true;
    if (component.classList.contains("barrier") && ui.activeBarrierId === component.dataset.barrierId) {
      return true;
    }
    return false;
  }

  function startEditSession(el, getValue, setValue) {
    editSession = { el, originalValue: getValue(), getValue, setValue };
  }

  function applyEditSession() {
    if (!editSession) return;
    const { el, setValue } = editSession;
    const value = readEditableText(el);
    if (el.classList.contains("desc-text")) {
      el.dataset.full = value;
    }
    setValue(value);
    editSession = null;
    commit(() => {});
    if (el.classList.contains("desc-text")) {
      applyDescriptionTruncation(el, value);
      fitBarrierDescription(el, { respectFocus: false });
    }
    positionAllConnectors();
  }

  function cancelEditSession() {
    if (!editSession) return;
    const { el, originalValue, setValue } = editSession;
    setValue(originalValue);
    if (el.classList.contains("desc-text")) {
      el.dataset.full = originalValue;
      if (el === document.activeElement) {
        writeEditableText(el, originalValue);
      } else {
        applyDescriptionTruncation(el, originalValue);
        fitBarrierDescription(el, { respectFocus: false });
      }
    } else {
      writeEditableText(el, originalValue);
    }
    editSession = null;
    commit(() => {});
    positionAllConnectors();
  }

  function handleEditBlur(el) {
    if (!editSession || editSession.el !== el) return;
    if (blurNavigation === "cancel" || blurNavigation === "apply") {
      blurNavigation = null;
      return;
    }

    if (blurNavigation === "tab" && isEditContextSelected(el)) {
      const related = document.activeElement;
      const leaving = el.closest(".card, .barrier, .hazard, .top-event");
      const entering = related?.closest?.(".card, .barrier, .hazard, .top-event");
      const tabWithinSameComponent =
        leaving &&
        entering &&
        domIdForComponent(leaving) === domIdForComponent(entering);

      if (tabWithinSameComponent) {
        const value = readEditableText(el);
        if (el.classList.contains("desc-text")) el.dataset.full = value;
        editSession.setValue(value);
        editSession = null;
      } else {
        cancelEditSession();
      }
      blurNavigation = null;
      return;
    }

    applyEditSession();
    blurNavigation = null;
  }

  function finishEditingAfterApply(active) {
    const component = active.closest(".card, .barrier, .hazard, .top-event");
    if (!component) return;
    if (active.dataset.role === "id" && component.querySelector('[data-role="description"]')) {
      beginFieldEdit(component, "description");
    } else {
      selectComponent(component);
    }
  }

  function getKeyboardHoverEl() {
    return document.querySelector(
      ".card.is-keyboard-hover, .barrier.is-keyboard-hover, .hazard.is-keyboard-hover, .top-event.is-keyboard-hover"
    );
  }

  function isComponentSelected() {
    return !!(ui.activeBarrierId || selectedFocusDomId || ui.selectedIds.size);
  }

  function clearKeyboardHover() {
    document.querySelectorAll(".is-keyboard-hover").forEach((el) => {
      el.classList.remove("is-keyboard-hover");
    });
  }

  function beginFieldEdit(componentEl, role = "id") {
    if (!componentEl) return;
    const field = componentEl.querySelector(`[data-role="${role}"]`);
    if (!field) return;
    clearKeyboardHover();
    componentEl.classList.remove("is-selected");
    field.focus();
  }

  function focusBarrierIdField(barrierId) {
    const seg = getBarrierSegmentEls(barrierId)[0];
    if (seg) beginFieldEdit(seg, "id");
  }

  function getSelectedComponentEl() {
    if (ui.activeBarrierId) return getBarrierSegmentEls(ui.activeBarrierId)[0] || null;
    if (selectedFocusDomId === "hazard") return document.querySelector(".hazard");
    if (selectedFocusDomId === "top-event") return document.querySelector(".top-event");
    if (selectedFocusDomId) return document.getElementById(selectedFocusDomId);
    return null;
  }

  function getCausesInRowOrder() {
    return Array.from(zoneLeft.querySelectorAll('.card[data-kind="cause"]')).sort(
      (a, b) => Number(a.dataset.row) - Number(b.dataset.row)
    );
  }

  function getConsequencesInRowOrder() {
    return Array.from(zoneRight.querySelectorAll('.card[data-kind="consequence"]')).sort(
      (a, b) => Number(a.dataset.row) - Number(b.dataset.row)
    );
  }

  function getCurrentNavComponentEl() {
    const fromFocus = document.activeElement?.closest(".card, .barrier, .hazard, .top-event");
    if (fromFocus && !document.activeElement?.isContentEditable) return fromFocus;
    const hovered = getKeyboardHoverEl();
    if (hovered) return hovered;
    return getSelectedComponentEl();
  }

  function getComponentNavKind(el) {
    if (!el) return null;
    if (el.classList.contains("hazard")) return "hazard";
    if (el.classList.contains("top-event")) return "top-event";
    if (el.classList.contains("card")) {
      return el.dataset.kind === "cause" ? "cause" : "consequence";
    }
    if (el.classList.contains("barrier")) {
      return el.closest("#zone-left") ? "preventiveBarrier" : "reactiveBarrier";
    }
    return null;
  }

  function barrierNavIndex(barriers, el) {
    const barrierId = el.dataset.barrierId;
    return barriers.findIndex((seg) => seg.dataset.barrierId === barrierId);
  }

  function cardNavIndex(cards, el) {
    return cards.findIndex((card) => card.id === el.id);
  }

  function setKeyboardNavTarget(el, { select = isComponentSelected() } = {}) {
    clearKeyboardHover();
    if (!el) return;
    if (select) {
      if (el.classList.contains("barrier")) {
        enterLinkMode(el.dataset.barrierId);
      } else {
        selectComponent(el);
      }
    }
    el.classList.add("is-keyboard-hover");
  }

  function navigateComponents(key) {
    const hoverOnly = { select: false };
    const causes = getCausesInRowOrder();
    const consequences = getConsequencesInRowOrder();
    const preventiveBarriers = firstBarrierSegmentsInColumnOrder(zoneLeft);
    const reactiveBarriers = firstBarrierSegmentsInColumnOrder(zoneRight);
    const hazard = document.querySelector(".hazard");
    const topEvent = document.querySelector(".top-event");

    const current = getCurrentNavComponentEl();
    if (!current) {
      if (causes.length) setKeyboardNavTarget(causes[0], hoverOnly);
      else if (preventiveBarriers.length) setKeyboardNavTarget(preventiveBarriers[0], hoverOnly);
      else if (hazard) setKeyboardNavTarget(hazard, hoverOnly);
      else if (topEvent) setKeyboardNavTarget(topEvent, hoverOnly);
      else if (reactiveBarriers.length) setKeyboardNavTarget(reactiveBarriers[0], hoverOnly);
      else if (consequences.length) setKeyboardNavTarget(consequences[0], hoverOnly);
      return;
    }

    const kind = getComponentNavKind(current);
    let next = null;

    if (kind === "cause") {
      const index = cardNavIndex(causes, current);
      if (key === "ArrowUp" && index > 0) next = causes[index - 1];
      else if (key === "ArrowDown" && index >= 0 && index < causes.length - 1) next = causes[index + 1];
      else if (key === "ArrowRight") {
        next = preventiveBarriers[0] || topEvent || hazard;
      }
    } else if (kind === "preventiveBarrier") {
      const index = barrierNavIndex(preventiveBarriers, current);
      if (key === "ArrowLeft") {
        next = index > 0 ? preventiveBarriers[index - 1] : causes[0] || null;
      } else if (key === "ArrowRight") {
        next =
          index >= 0 && index < preventiveBarriers.length - 1
            ? preventiveBarriers[index + 1]
            : topEvent || hazard;
      }
    } else if (kind === "hazard") {
      if (key === "ArrowLeft") {
        next = preventiveBarriers[preventiveBarriers.length - 1] || causes[causes.length - 1] || null;
      } else if (key === "ArrowRight") {
        next = topEvent;
      }
    } else if (kind === "top-event") {
      if (key === "ArrowLeft") {
        next = preventiveBarriers[preventiveBarriers.length - 1] || causes[causes.length - 1] || hazard;
      } else if (key === "ArrowRight") {
        next = reactiveBarriers[0] || consequences[0] || null;
      }
    } else if (kind === "reactiveBarrier") {
      const index = barrierNavIndex(reactiveBarriers, current);
      if (key === "ArrowLeft") {
        next = index > 0 ? reactiveBarriers[index - 1] : topEvent || hazard;
      } else if (key === "ArrowRight") {
        next =
          index >= 0 && index < reactiveBarriers.length - 1
            ? reactiveBarriers[index + 1]
            : consequences[0] || null;
      }
    } else if (kind === "consequence") {
      const index = cardNavIndex(consequences, current);
      if (key === "ArrowUp" && index > 0) next = consequences[index - 1];
      else if (key === "ArrowDown" && index >= 0 && index < consequences.length - 1) {
        next = consequences[index + 1];
      } else if (key === "ArrowLeft") {
        next = reactiveBarriers[reactiveBarriers.length - 1] || topEvent || hazard;
      }
    }

    if (next) setKeyboardNavTarget(next, hoverOnly);
  }

  function getLinkTargetCardEls() {
    return getLeafCardsInRowOrder(ui.activeBarrierId)
      .map((card) => document.getElementById(card.domId))
      .filter(Boolean);
  }

  function navigateLinkTargets(direction) {
    const cards = getLinkTargetCardEls();
    if (!cards.length) return;

    let current = cards.find((card) => card.classList.contains("is-keyboard-hover"));
    if (!current) {
      current = cards.find(
        (card) => card.classList.contains("is-selected") && !card.classList.contains("is-unaffected")
      );
    }
    let index = current ? cards.indexOf(current) : -1;
    index = Math.max(0, Math.min(cards.length - 1, index + direction));

    cards.forEach((card) => card.classList.remove("is-keyboard-hover"));
    cards[index].classList.add("is-keyboard-hover");
  }

  function handleEnterOnComponent(evt) {
    if (evt.key !== "Enter" || evt.shiftKey) return false;

    if (ui.activeBarrierId) {
      const barrierId = ui.activeBarrierId;
      applyLinkMode();
      focusBarrierIdField(barrierId);
      evt.preventDefault();
      return true;
    }

    const el = getKeyboardHoverEl() || getSelectedComponentEl();
    if (!el) return false;

    evt.preventDefault();

    if (evt.metaKey || evt.ctrlKey) {
      if (el.classList.contains("barrier")) {
        enterLinkMode(el.dataset.barrierId);
      } else {
        selectComponent(el);
      }
      return true;
    }

    beginFieldEdit(
      el,
      el.classList.contains("hazard") || el.classList.contains("top-event") ? "description" : "id"
    );
    return true;
  }

  function wireDescriptionEditing(el, getFull, setFull) {
    el._getFull = getFull;
    el._setFull = setFull;

    const full = getFull();
    el.dataset.full = full;
    applyDescriptionTruncation(el, full);
    fitBarrierDescription(el);

    if (el.dataset.editingWired) return;
    el.dataset.editingWired = "1";

    el.addEventListener("focus", () => {
      startEditSession(el, el._getFull, el._setFull);
      const value = el._getFull();
      el.dataset.full = value;
      writeEditableText(el, value);
    });

    el.addEventListener("input", () => {
      el.dataset.full = readEditableText(el);
    });

    el.addEventListener("blur", () => {
      handleEditBlur(el);
    });
  }

  function wireIdTagEditing(el, getId, setId) {
    el._getId = getId;
    el._setId = setId;

    if (el.dataset.idWired) return;
    el.dataset.idWired = "1";

    el.addEventListener("focus", () => {
      startEditSession(el, el._getId, el._setId);
    });

    el.addEventListener("input", () => {
      const value = readEditableText(el);
      const barrierEl = el.closest(".barrier");
      if (barrierEl) {
        getBarrierSegmentEls(barrierEl.dataset.barrierId).forEach((seg) => {
          const tag = seg.querySelector('[data-role="id"]');
          if (tag && tag !== el) writeEditableText(tag, value);
        });
      }
      positionAllConnectors();
    });

    el.addEventListener("blur", () => {
      handleEditBlur(el);
    });
  }

  function createCardElement(card, kind) {
    const el = document.createElement("article");
    el.className = "card";
    el.id = card.domId;
    el.dataset.kind = kind;

    const idTag = document.createElement("div");
    idTag.className = "id-tag";
    idTag.contentEditable = "true";
    idTag.dataset.role = "id";
    idTag.id = card.idTagId;

    const desc = document.createElement("p");
    desc.className = "desc-text";
    desc.contentEditable = "true";
    desc.dataset.role = "description";

    el.append(idTag, desc);
    return el;
  }

  function createBarrierSegmentElement(barrier, seg, index) {
    const el = document.createElement("div");
    el.className = "barrier";
    el.id = segmentDomId(barrier, seg, index);
    el.dataset.barrierId = barrier.barrierId;

    const idTag = document.createElement("div");
    idTag.className = "id-tag";
    idTag.contentEditable = "true";
    idTag.dataset.role = "id";
    idTag.id = segmentIdTagId(barrier, seg, index);

    const desc = document.createElement("p");
    desc.className = "desc-text";
    desc.contentEditable = "true";
    desc.dataset.role = "description";

    el.append(idTag, desc);
    return el;
  }

  // ---------- Render ----------

  function syncCardElement(card, kind, col) {
    let el = document.getElementById(card.domId);
    const zone = kind === "cause" ? zoneLeft : zoneRight;
    if (!el) {
      el = createCardElement(card, kind);
      zone.appendChild(el);
    }

    applyPlacement(el, card.row, col, 1);

    const idTag = el.querySelector('[data-role="id"]');
    const desc = el.querySelector('[data-role="description"]');

    idTag.id = card.idTagId;
    idTag.dataset.target = card.connectorTarget;
    if (idTag !== document.activeElement) {
      writeEditableText(idTag, card.id);
    }

    if (desc !== document.activeElement) {
      desc.dataset.full = card.description;
      writeEditableText(desc, truncateDescription(card.description));
    }

    wireDescriptionEditing(
      desc,
      () => card.description,
      (value) => {
        card.description = value;
      }
    );
    wireIdTagEditing(
      idTag,
      () => card.id,
      (value) => {
        card.id = value;
      }
    );

    return el;
  }

  function syncBarrierSegments(barrier, leaves, zone) {
    const segments = segmentsForRender(barrier, leaves);
    const wantedIds = new Set();

    segments.forEach((seg, index) => {
      const domId = segmentDomId(barrier, seg, index);
      wantedIds.add(domId);

      let el = document.getElementById(domId);
      if (!el) {
        el = createBarrierSegmentElement(barrier, seg, index);
        zone.appendChild(el);
      }

      el.dataset.barrierId = barrier.barrierId;
      el.dataset.strength = barrier.strength;
      el.dataset.status = barrier.status;
      if (barrier.everLinked) {
        el.dataset.protects = barrier.protects.join(",");
      } else {
        delete el.dataset.protects;
      }

      applyPlacement(el, seg.row, barrier.col, seg.rowSpan);

      const idTag = el.querySelector('[data-role="id"]');
      const desc = el.querySelector('[data-role="description"]');

      idTag.id = segmentIdTagId(barrier, seg, index);
      if (idTag !== document.activeElement) {
        writeEditableText(idTag, barrier.id);
      }

      if (desc !== document.activeElement) {
        desc.dataset.full = barrier.description;
        writeEditableText(desc, truncateDescription(barrier.description));
      }

      wireDescriptionEditing(
        desc,
        () => barrier.description,
        (value) => {
          barrier.description = value;
        }
      );
      wireIdTagEditing(
        idTag,
        () => barrier.id,
        (value) => {
          barrier.id = value;
        }
      );
    });

    zone.querySelectorAll(`.barrier[data-barrier-id="${barrier.barrierId}"]`).forEach((el) => {
      if (!wantedIds.has(el.id)) el.remove();
    });
  }

  function syncCenterAnchor(root, id) {
    if (!root) return null;
    let anchor = root.querySelector("[id^='id-']");
    if (!anchor) {
      anchor = document.createElement("span");
      anchor.hidden = true;
      anchor.tabIndex = -1;
      anchor.setAttribute("aria-hidden", "true");
      root.insertBefore(anchor, root.querySelector('[data-role="description"]'));
    }
    anchor.id = `id-${id}`;
    return anchor;
  }

  function renderCenter(s) {
    document.body.dataset.theme = s.meta.theme;
    document.querySelectorAll('[data-action="setTheme"]').forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.themeValue === s.meta.theme);
    });

    const hazardRoot = document.querySelector(".hazard");
    const topEventRoot = document.querySelector(".top-event");
    syncCenterAnchor(hazardRoot, s.hazard.id);
    syncCenterAnchor(topEventRoot, s.topEvent.id);

    const hazardDesc = hazardRoot?.querySelector('[data-role="description"]');
    if (hazardDesc && hazardDesc !== document.activeElement) {
      hazardDesc.dataset.full = s.hazard.label;
      writeEditableText(hazardDesc, truncateDescription(s.hazard.label));
    }
    if (hazardDesc) {
      wireDescriptionEditing(
        hazardDesc,
        () => s.hazard.label,
        (value) => {
          s.hazard.label = value;
        }
      );
    }

    const topEventDesc = topEventRoot?.querySelector('[data-role="description"]');
    if (topEventDesc && topEventDesc !== document.activeElement) {
      topEventDesc.dataset.full = s.topEvent.label;
      writeEditableText(topEventDesc, truncateDescription(s.topEvent.label));
    }
    if (topEventDesc) {
      wireDescriptionEditing(
        topEventDesc,
        () => s.topEvent.label,
        (value) => {
          s.topEvent.label = value;
        }
      );
    }
  }

  function applySelectionUI() {
    document.querySelectorAll(".card.is-selected, .hazard.is-selected, .top-event.is-selected").forEach((el) => {
      el.classList.remove("is-selected");
    });
    ui.selectedIds.forEach((domId) => {
      if (domId === "hazard") {
        document.querySelector(".hazard")?.classList.add("is-selected");
      } else if (domId === "top-event") {
        document.querySelector(".top-event")?.classList.add("is-selected");
      } else {
        document.getElementById(domId)?.classList.add("is-selected");
      }
    });
  }

  function applyLinkModeUI() {
    document.querySelectorAll(".card.link-target").forEach((card) => {
      card.classList.remove("link-target", "is-selected", "is-unaffected");
    });
    getBarrierSegmentEls(ui.activeBarrierId || "").forEach((seg) => {
      seg.classList.remove("is-selected");
    });

    const barrier = getActiveBarrierState();
    if (!barrier) {
      document.body.classList.remove("linking-mode");
      return;
    }

    document.body.classList.add("linking-mode");
    getBarrierSegmentEls(barrier.barrierId).forEach((seg) => seg.classList.add("is-selected"));

    const side = barrierSide(barrier.barrierId);
    const zone = side === "left" ? zoneLeft : zoneRight;
    const kind = side === "left" ? "cause" : "consequence";

    zone.querySelectorAll(`.card[data-kind="${kind}"]`).forEach((card) => {
      card.classList.add("link-target");
      const idTag = card.querySelector('[data-role="id"]');
      const idTagId = idTag ? idTag.id : null;
      const isProtected = !!idTagId && barrier.protects.includes(idTagId);
      card.classList.toggle("is-selected", isProtected);
      card.classList.toggle("is-unaffected", !isProtected);
    });
  }

  function render(s) {
    rebuildLeftGrid(s.left);
    rebuildRightGrid(s.right);
    renderCenter(s);

    const keptCauseIds = new Set();
    s.left.causes.forEach((card) => {
      syncCardElement(card, "cause", 1);
      keptCauseIds.add(card.domId);
    });
    zoneLeft.querySelectorAll('.card[data-kind="cause"]').forEach((el) => {
      if (!keptCauseIds.has(el.id)) el.remove();
    });

    const keptConsequenceIds = new Set();
    const consequenceCol = s.right.barrierCols + 1;
    s.right.consequences.forEach((card) => {
      syncCardElement(card, "consequence", consequenceCol);
      keptConsequenceIds.add(card.domId);
    });
    zoneRight.querySelectorAll('.card[data-kind="consequence"]').forEach((el) => {
      if (!keptConsequenceIds.has(el.id)) el.remove();
    });

    const keptLeftBarrierIds = new Set(s.left.barriers.map((b) => b.barrierId));
    s.left.barriers.forEach((barrier) => {
      syncBarrierSegments(barrier, s.left.causes, zoneLeft);
    });
    zoneLeft.querySelectorAll(".barrier").forEach((el) => {
      if (!keptLeftBarrierIds.has(el.dataset.barrierId)) el.remove();
    });

    const keptRightBarrierIds = new Set(s.right.barriers.map((b) => b.barrierId));
    s.right.barriers.forEach((barrier) => {
      syncBarrierSegments(barrier, s.right.consequences, zoneRight);
    });
    zoneRight.querySelectorAll(".barrier").forEach((el) => {
      if (!keptRightBarrierIds.has(el.dataset.barrierId)) el.remove();
    });

    applySelectionUI();
    applyLinkModeUI();
    fitAllBarrierDescriptions();
    updateTabOrder();
  }

  function commit(mutator) {
    mutator(state);
    validateState(state);
    render(state);
    buildConnectors();
  }

  // ---------- Connectors ----------

  function toBowtiePoint(el, edge) {
    const bowtieRect = bowtie.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    let x = rect.left + rect.width / 2 - bowtieRect.left;
    let y = rect.top + rect.height / 2 - bowtieRect.top;
    if (edge === "left") x = rect.left - bowtieRect.left;
    else if (edge === "right") x = rect.right - bowtieRect.left;
    else if (edge === "top") y = rect.top - bowtieRect.top;
    else if (edge === "bottom") y = rect.bottom - bowtieRect.top;
    return { x, y };
  }

  function makeSvgLine() {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("stroke-width", "1");
    return line;
  }

  function connectorColor() {
    return getComputedStyle(document.body).getPropertyValue("--color-foreground").trim();
  }

  function buildConnectors() {
    clearConnectors();
    const lineColor = connectorColor();

    document.querySelectorAll("[data-target]").forEach((source) => {
      const anchorSource = source.closest(".card") || source;
      const side = anchorSource.closest("#zone-right") ? "right" : "left";
      const exitSocket = side === "left" ? "right" : "left";
      const bendEdge = side;
      const arriveSocket = side === "left" ? "left" : "right";

      source.dataset.target
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .forEach((targetId) => {
          const target = document.getElementById(targetId);
          if (!target) return;
          const anchorTarget = target.closest(".top-event") || target.closest(".card") || target;

          const lineA = makeSvgLine();
          const lineB = makeSvgLine();
          lineA.setAttribute("stroke", lineColor);
          lineB.setAttribute("stroke", lineColor);
          connectorsSvg.append(lineA, lineB);

          connectors.push({
            lineA,
            lineB,
            source: anchorSource,
            target: anchorTarget,
            bendEdge,
            exitSocket,
            arriveSocket,
          });
        });
    });

    const hazard = document.querySelector(".hazard");
    const topEvent = document.querySelector(".top-event");
    if (hazard && topEvent) {
      const line = makeSvgLine();
      line.setAttribute("stroke", lineColor);
      connectorsSvg.append(line);
      connectors.push({ kind: "hazard", lineA: line, lineB: null, source: hazard, target: topEvent });
    }

    positionAllConnectors();
    updateTabOrder();
  }

  function clearConnectors() {
    while (connectors.length) {
      const c = connectors.pop();
      c.lineA.remove();
      if (c.lineB) c.lineB.remove();
    }
  }

  function positionAllConnectors() {
    if (!connectors.length) return;

    const centerRect = zoneCenter.getBoundingClientRect();
    const bowtieRect = bowtie.getBoundingClientRect();
    const lineColor = connectorColor();

    connectors.forEach((c) => {
      if (c.kind === "hazard") {
        const sourcePt = toBowtiePoint(c.source, "bottom");
        const targetPt = toBowtiePoint(c.target, "top");
        c.lineA.setAttribute("x1", sourcePt.x);
        c.lineA.setAttribute("y1", sourcePt.y);
        c.lineA.setAttribute("x2", targetPt.x);
        c.lineA.setAttribute("y2", targetPt.y);
        c.lineA.setAttribute("stroke", lineColor);
        return;
      }

      const sourcePt = toBowtiePoint(c.source, c.exitSocket);
      const targetPt = toBowtiePoint(c.target, c.arriveSocket);
      const sourceRect = c.source.getBoundingClientRect();
      const bendY = sourceRect.top + sourceRect.height / 2 - bowtieRect.top;
      const bendX =
        c.bendEdge === "left" ? centerRect.left - bowtieRect.left : centerRect.right - bowtieRect.left;

      c.lineA.setAttribute("x1", sourcePt.x);
      c.lineA.setAttribute("y1", sourcePt.y);
      c.lineA.setAttribute("x2", bendX);
      c.lineA.setAttribute("y2", bendY);
      c.lineB.setAttribute("x1", bendX);
      c.lineB.setAttribute("y1", bendY);
      c.lineB.setAttribute("x2", targetPt.x);
      c.lineB.setAttribute("y2", targetPt.y);
      c.lineA.setAttribute("stroke", lineColor);
      c.lineB.setAttribute("stroke", lineColor);
    });
  }

  // ---------- Tab order ----------

  function fieldsOf(el) {
    return el ? Array.from(el.querySelectorAll(".id-tag, .desc-text")) : [];
  }

  function firstBarrierSegmentsInColumnOrder(zone) {
    const groups = new Map();
    zone.querySelectorAll(".barrier").forEach((seg) => {
      const id = seg.dataset.barrierId;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(seg);
    });
    return Array.from(groups.values())
      .map((segs) =>
        segs.sort(
          (a, b) =>
            Number(a.dataset.row) - Number(b.dataset.row) || Number(a.dataset.col) - Number(b.dataset.col)
        )[0]
      )
      .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
  }

  function updateTabOrder() {
    const toolbarBtns = Array.from(document.querySelectorAll(".toolbar .action-btn"));

    const causes = Array.from(zoneLeft.querySelectorAll('.card[data-kind="cause"]')).sort(
      (a, b) => Number(a.dataset.row) - Number(b.dataset.row)
    );
    const consequences = Array.from(zoneRight.querySelectorAll('.card[data-kind="consequence"]')).sort(
      (a, b) => Number(a.dataset.row) - Number(b.dataset.row)
    );
    const preventiveBarriers = firstBarrierSegmentsInColumnOrder(zoneLeft);
    const reactiveBarriers = firstBarrierSegmentsInColumnOrder(zoneRight);
    const hazard = document.querySelector(".hazard");
    const topEvent = document.querySelector(".top-event");

    const orderedFields = [
      ...causes.flatMap(fieldsOf),
      ...preventiveBarriers.flatMap(fieldsOf),
      ...fieldsOf(hazard),
      ...fieldsOf(topEvent),
      ...reactiveBarriers.flatMap(fieldsOf),
      ...consequences.flatMap(fieldsOf),
    ];

    let i = 1;
    [...toolbarBtns, ...orderedFields].forEach((el) => {
      el.tabIndex = i++;
    });

    document.querySelectorAll(".barrier .id-tag, .barrier .desc-text").forEach((f) => {
      if (!orderedFields.includes(f)) f.tabIndex = -1;
    });
  }

  // ---------- Selection & linking ----------

  function snapshotCardRows(side) {
    const cards = side === "left" ? state.left.causes : state.right.consequences;
    return cards.map((c) => ({ domId: c.domId, row: c.row }));
  }

  function snapshotBarrierCols(side) {
    const barriers = side === "left" ? state.left.barriers : state.right.barriers;
    return barriers.map((b) => ({ barrierId: b.barrierId, col: b.col }));
  }

  function cancelCardLayoutChanges() {
    if (!selectionLayoutSnapshot) return;
    const snap = selectionLayoutSnapshot;
    commit((s) => {
      const cards = snap.side === "left" ? s.left.causes : s.right.consequences;
      snap.rows.forEach(({ domId, row }) => {
        const card = cards.find((c) => c.domId === domId);
        if (card) card.row = row;
      });
    });
    selectionLayoutSnapshot = null;
    selectionLayoutDirty = false;
  }

  function clearComponentSelection() {
    clearKeyboardHover();
    ui.selectedIds.forEach((domId) => {
      if (domId === "hazard") document.querySelector(".hazard")?.classList.remove("is-selected");
      else if (domId === "top-event") document.querySelector(".top-event")?.classList.remove("is-selected");
      else document.getElementById(domId)?.classList.remove("is-selected");
    });
    ui.selectedIds.clear();
    ui.selectionAnchorId = null;
    selectedFocusDomId = null;
    selectionLayoutSnapshot = null;
    selectionLayoutDirty = false;
  }

  function domIdForComponent(el) {
    if (el.classList.contains("hazard")) return "hazard";
    if (el.classList.contains("top-event")) return "top-event";
    return el.id;
  }

  function selectComponent(el) {
    if (!el) return;
    if (el.classList.contains("barrier")) {
      enterLinkMode(el.dataset.barrierId);
      return;
    }
    clearComponentSelection();
    const domId = domIdForComponent(el);
    selectedFocusDomId = domId;
    ui.selectionAnchorId = domId;
    ui.selectedIds.add(domId);
    el.classList.add("is-selected");
    if (el.classList.contains("card")) {
      const isLeft = !!state.left.causes.find((c) => c.domId === domId);
      const side = isLeft ? "left" : "right";
      selectionLayoutSnapshot = { side, rows: snapshotCardRows(side) };
      selectionLayoutDirty = false;
    }
  }

  function extendSelection(direction) {
    selectionLayoutSnapshot = null;
    selectionLayoutDirty = false;
    if (!selectedFocusDomId) return;
    const focusCard = findCardByDomId(selectedFocusDomId);
    if (!focusCard) return;
    if (!ui.selectionAnchorId) ui.selectionAnchorId = selectedFocusDomId;

    const anchor = findCardByDomId(ui.selectionAnchorId);
    if (!anchor) return;

    const isLeft = !!state.left.causes.find((c) => c.domId === ui.selectionAnchorId);
    const cards = isLeft ? state.left.causes : state.right.consequences;
    const siblings = [...cards].sort((a, b) => a.row - b.row);
    if (!siblings.length) return;

    const anchorRow = anchor.row;
    const focusRow = Math.max(1, Math.min(siblings.length, focusCard.row + direction));
    const lo = Math.min(anchorRow, focusRow);
    const hi = Math.max(anchorRow, focusRow);

    ui.selectedIds.clear();
    siblings.forEach((card) => {
      if (card.row < lo || card.row > hi) return;
      ui.selectedIds.add(card.domId);
      if (card.row === focusRow) selectedFocusDomId = card.domId;
    });
    applySelectionUI();
  }

  function toggleCardSelection(cardEl) {
    const domId = cardEl.id;
    if (ui.selectedIds.has(domId)) {
      ui.selectedIds.delete(domId);
      cardEl.classList.remove("is-selected");
      if (selectedFocusDomId === domId) {
        selectedFocusDomId = ui.selectedIds.values().next().value || null;
      }
      if (!ui.selectedIds.size) ui.selectionAnchorId = null;
      return;
    }

    const isLeft = !!state.left.causes.find((c) => c.domId === domId);
    const anchorIsLeft = ui.selectionAnchorId
      ? !!state.left.causes.find((c) => c.domId === ui.selectionAnchorId)
      : false;
    const sameType =
      selectedFocusDomId &&
      findCardByDomId(selectedFocusDomId) &&
      ui.selectionAnchorId &&
      anchorIsLeft === isLeft;

    if (!sameType) {
      selectComponent(cardEl);
      return;
    }

    ui.selectedIds.add(domId);
    cardEl.classList.add("is-selected");
    selectedFocusDomId = domId;
    selectionLayoutSnapshot = null;
    selectionLayoutDirty = false;
  }

  function clearLinkModeUI(prevBarrierId) {
    clearKeyboardHover();
    ui.activeBarrierId = null;
    linkModeSnapshot = null;
    document.body.classList.remove("linking-mode");
    document.querySelectorAll(".card.link-target").forEach((card) => {
      card.classList.remove("link-target", "is-selected", "is-unaffected", "is-keyboard-hover");
    });
    if (prevBarrierId) {
      getBarrierSegmentEls(prevBarrierId).forEach((seg) => seg.classList.remove("is-selected"));
    }
  }

  function enterLinkMode(barrierId) {
    if (ui.activeBarrierId === barrierId) return;
    applyLinkMode();
    clearComponentSelection();
    const side = barrierSide(barrierId);
    const barrier = side ? findBarrier(barrierId, side) : null;
    if (barrier) {
      const leaves = side === "left" ? state.left.causes : state.right.consequences;
      linkModeSnapshot = {
        barrierId,
        protects: [...barrier.protects],
        everLinked: barrier.everLinked,
        barrierCols: snapshotBarrierCols(side),
      };
      barrier.authoredSegments = computeBarrierSegments(barrier, leaves);
    }
    ui.activeBarrierId = barrierId;
    applyLinkModeUI();
    render(state);
    buildConnectors();
  }

  function cancelLinkMode() {
    if (!ui.activeBarrierId || !linkModeSnapshot) return;
    const prevBarrierId = ui.activeBarrierId;
    const side = barrierSide(prevBarrierId);
    const barrier = side ? findBarrier(prevBarrierId, side) : null;
    if (barrier && linkModeSnapshot.barrierId === prevBarrierId) {
      barrier.protects = [...linkModeSnapshot.protects];
      barrier.everLinked = linkModeSnapshot.everLinked;
      const leaves = side === "left" ? state.left.causes : state.right.consequences;
      barrier.authoredSegments = computeBarrierSegments(barrier, leaves);
    }
    if (side && linkModeSnapshot.barrierCols) {
      const barriers = side === "left" ? state.left.barriers : state.right.barriers;
      linkModeSnapshot.barrierCols.forEach(({ barrierId, col }) => {
        const b = barriers.find((x) => x.barrierId === barrierId);
        if (b) b.col = col;
      });
    }
    clearLinkModeUI(prevBarrierId);
    commit(() => {});
  }

  function applyLinkMode() {
    if (!ui.activeBarrierId) return;
    const prevBarrierId = ui.activeBarrierId;
    const side = barrierSide(prevBarrierId);
    const barrier = side ? findBarrier(prevBarrierId, side) : null;
    if (barrier) {
      const leaves = side === "left" ? state.left.causes : state.right.consequences;
      barrier.authoredSegments = computeBarrierSegments(barrier, leaves);
    }
    clearLinkModeUI(prevBarrierId);
    commit(() => {});
  }

  function exitLinkMode() {
    applyLinkMode();
  }

  function toggleProtection(cardEl) {
    const barrier = getActiveBarrierState();
    if (!barrier) return;
    const idTag = cardEl.querySelector('[data-role="id"]');
    if (!idTag) return;

    barrier.everLinked = true;
    const index = barrier.protects.indexOf(idTag.id);
    if (index >= 0) barrier.protects.splice(index, 1);
    else barrier.protects.push(idTag.id);

    applyLinkModeUI();
  }

  function getLeafCardsInRowOrder(barrierId) {
    const side = barrierSide(barrierId);
    const cards = side === "left" ? state.left.causes : state.right.consequences;
    return [...cards].sort((a, b) => a.row - b.row);
  }

  // ---------- Mutations ----------

  function applyLegendRow(barrierId, row) {
    commit((s) => {
      const side = barrierSide(barrierId);
      const barrier = findBarrier(barrierId, side);
      if (!barrier) return;
      if (row.dataset.status) barrier.status = row.dataset.status;
      if (row.dataset.strength) barrier.strength = row.dataset.strength;
    });
  }

  function moveBarrierColumn(barrierId, direction) {
    commit((s) => {
      const side = barrierSide(barrierId);
      const barriers = side === "left" ? s.left.barriers : s.right.barriers;
      const barrier = barriers.find((b) => b.barrierId === barrierId);
      if (!barrier) return;

      const minCol = side === "left" ? 2 : 1;
      const maxCol = side === "left" ? 1 + s.left.barrierCols : s.right.barrierCols;
      const targetCol = barrier.col + direction;
      if (targetCol < minCol || targetCol > maxCol) return;

      const other = barriers.find((b) => b.barrierId !== barrierId && b.col === targetCol);
      barrier.col = targetCol;
      if (other) other.col = targetCol - direction;
    });
  }

  function moveCardRow(domId, direction) {
    commit((s) => {
      const cause = s.left.causes.find((c) => c.domId === domId);
      const isLeft = !!cause;
      const cards = isLeft ? s.left.causes : s.right.consequences;
      const card = cause || s.right.consequences.find((c) => c.domId === domId);
      if (!card) return;

      const maxRow = isLeft ? s.left.rows : s.right.rows;
      const currentRow = card.row;
      const targetRow = currentRow + direction;
      if (targetRow < 1 || targetRow > maxRow) return;

      const other = cards.find((c) => c.row === targetRow);
      card.row = targetRow;
      if (other) other.row = currentRow;

      const movedIds = [card.idTagId];
      if (other) movedIds.push(other.idTagId);
      const barriers = isLeft ? s.left.barriers : s.right.barriers;
      barriers.forEach((b) => {
        if (b.everLinked && b.protects.some((id) => movedIds.includes(id))) {
          // segments recomputed on render
        }
      });
    });
    selectionLayoutDirty = true;
  }

  function deleteCard(domId) {
    commit((s) => {
      const causeIndex = s.left.causes.findIndex((c) => c.domId === domId);
      const isLeft = causeIndex >= 0;
      const cards = isLeft ? s.left.causes : s.right.consequences;
      const index = isLeft ? causeIndex : s.right.consequences.findIndex((c) => c.domId === domId);
      if (index < 0) return;

      const removed = cards.splice(index, 1)[0];
      cards.sort((a, b) => a.row - b.row).forEach((c, i) => {
        c.row = i + 1;
      });

      if (isLeft) s.left.rows = Math.max(cards.length, 1);
      else s.right.rows = Math.max(cards.length, 1);

      const barriers = isLeft ? s.left.barriers : s.right.barriers;
      barriers.forEach((b) => {
        const idx = b.protects.indexOf(removed.idTagId);
        if (idx >= 0) b.protects.splice(idx, 1);
      });

      clearComponentSelection();
    });
  }

  function deleteBarrierGroup(barrierId) {
    commit((s) => {
      const side = barrierSide(barrierId);
      const barriers = side === "left" ? s.left.barriers : s.right.barriers;
      const index = barriers.findIndex((b) => b.barrierId === barrierId);
      if (index < 0) return;

      const removed = barriers.splice(index, 1)[0];
      clearLinkModeUI(barrierId);

      barriers.forEach((b) => {
        if (b.col > removed.col) b.col -= 1;
      });

      if (side === "left") {
        s.left.barrierCols = Math.max(s.left.barrierCols - 1, 0);
      } else {
        s.right.barrierCols = Math.max(s.right.barrierCols - 1, 0);
      }
    });
  }

  function addCause() {
    commit((s) => {
      s.meta.seq.cause += 1;
      s.left.rows += 1;
      const id = `C${s.meta.seq.cause}`;
      s.left.causes.push({
        id,
        domId: `c-${id}`,
        idTagId: `id-${id}`,
        description: "New cause description",
        row: s.left.rows,
        connectorTarget: `id-${s.topEvent.id}`,
      });
    });
  }

  function addConsequence() {
    commit((s) => {
      s.meta.seq.consequence += 1;
      s.right.rows += 1;
      const id = `K${s.meta.seq.consequence}`;
      s.right.consequences.push({
        id,
        domId: `c-${id}`,
        idTagId: `id-${id}`,
        description: "New consequence description",
        row: s.right.rows,
        connectorTarget: `id-${s.topEvent.id}`,
      });
    });
  }

  function addPreventiveBarrier() {
    commit((s) => {
      s.meta.seq.preventiveBarrier += 1;
      s.left.barrierCols += 1;
      const id = `P${s.meta.seq.preventiveBarrier}`;
      const barrierId = id.toLowerCase();
      const authoredSegments = [{ row: 1, rowSpan: s.left.rows }];
      const protects = inferProtectionsFromLeaves(authoredSegments, s.left.causes);
      s.left.barriers.push({
        barrierId,
        id,
        description: "New preventive barrier",
        col: 1 + s.left.barrierCols,
        strength: "Normal",
        status: "Unknown",
        protects,
        everLinked: false,
        authoredSegments,
      });
    });
  }

  function addReactiveBarrier() {
    commit((s) => {
      s.meta.seq.reactiveBarrier += 1;
      s.right.barrierCols += 1;
      const id = `R${s.meta.seq.reactiveBarrier}`;
      const barrierId = id.toLowerCase();
      const authoredSegments = [{ row: 1, rowSpan: s.right.rows }];
      const protects = inferProtectionsFromLeaves(authoredSegments, s.right.consequences);
      s.right.barriers.push({
        barrierId,
        id,
        description: "New reactive barrier",
        col: s.right.barrierCols,
        strength: "Normal",
        status: "Unknown",
        protects,
        everLinked: false,
        authoredSegments,
      });
    });
  }

  function setTheme(theme) {
    commit((s) => {
      s.meta.theme = theme;
    });
  }

  // ---------- Toolbar ----------

  const actions = {
    addCause,
    addPreventiveBarrier,
    addReactiveBarrier,
    addConsequence,
    setTheme: (btn) => setTheme(btn.dataset.themeValue),
    exportState: exportStateToFile,
    importState: () => document.getElementById("import-state-file")?.click(),
  };

  function flashButton(btn) {
    btn.classList.add("is-flashed");
    setTimeout(() => btn.classList.remove("is-flashed"), 150);
  }

  function runAction(btn) {
    const action = btn.dataset.action;
    if (action === "setTheme") actions.setTheme(btn);
    else if (actions[action]) actions[action]();
    flashButton(btn);
  }

  // ---------- Event handlers ----------

  function isModClick(evt) {
    return evt.metaKey || evt.ctrlKey;
  }

  document.querySelectorAll(".legend-row[data-status], .legend-row[data-strength]").forEach((row) => {
    row.addEventListener("click", () => {
      if (!ui.activeBarrierId) return;
      applyLegendRow(ui.activeBarrierId, row);
    });
  });

  document.addEventListener("keydown", (evt) => {
    if (!ui.activeBarrierId) return;
    if (document.activeElement && document.activeElement.isContentEditable) return;

    if (evt.key === "Enter" && !evt.shiftKey) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      const barrierId = ui.activeBarrierId;
      applyLinkMode();
      focusBarrierIdField(barrierId);
      return;
    }

    if (evt.metaKey || evt.ctrlKey || evt.altKey) return;

    if (/^[1-9]$/.test(evt.key)) {
      const cards = getLeafCardsInRowOrder(ui.activeBarrierId);
      const cardState = cards[Number(evt.key) - 1];
      if (cardState) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        const cardEl = document.getElementById(cardState.domId);
        if (cardEl) toggleProtection(cardEl);
      }
      return;
    }

    if (evt.key === "ArrowLeft" || evt.key === "ArrowRight") {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      moveBarrierColumn(ui.activeBarrierId, evt.key === "ArrowLeft" ? -1 : 1);
      return;
    }

    if (evt.key === "ArrowUp" || evt.key === "ArrowDown") {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      navigateLinkTargets(evt.key === "ArrowUp" ? -1 : 1);
      return;
    }

    const legendRow = document.querySelector(`.legend-row[data-shortcut="${evt.key.toLowerCase()}"]`);
    if (legendRow) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      applyLegendRow(ui.activeBarrierId, legendRow);
    }
  });

  document.addEventListener("keydown", (evt) => {
    if (document.activeElement && document.activeElement.isContentEditable) return;
    if (ui.activeBarrierId) return;

    const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!arrowKeys.includes(evt.key)) return;

    if (
      evt.altKey &&
      !evt.metaKey &&
      !evt.ctrlKey &&
      (evt.key === "ArrowUp" || evt.key === "ArrowDown") &&
      selectedFocusDomId &&
      findCardByDomId(selectedFocusDomId) &&
      ui.selectedIds.size <= 1
    ) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      moveCardRow(selectedFocusDomId, evt.key === "ArrowUp" ? -1 : 1);
      return;
    }

    if (
      evt.shiftKey &&
      !evt.altKey &&
      !evt.metaKey &&
      !evt.ctrlKey &&
      (evt.key === "ArrowUp" || evt.key === "ArrowDown") &&
      selectedFocusDomId &&
      findCardByDomId(selectedFocusDomId)
    ) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      extendSelection(evt.key === "ArrowUp" ? -1 : 1);
      return;
    }

    if (evt.metaKey || evt.ctrlKey || evt.altKey || evt.shiftKey) return;

    evt.preventDefault();
    evt.stopImmediatePropagation();
    navigateComponents(evt.key);
  });

  document.addEventListener("mousedown", (evt) => {
    if (bowtie.contains(evt.target)) clearKeyboardHover();
    const cardEl = evt.target.closest(".card");
    if (cardEl && cardEl.classList.contains("link-target")) evt.preventDefault();
    if (isModClick(evt) && evt.target.closest(".id-tag, .desc-text")) {
      evt.preventDefault();
    }
  });

  document.addEventListener("click", (evt) => {
    const mod = isModClick(evt);
    const barrierEl = evt.target.closest(".barrier");
    const cardEl = evt.target.closest(".card");
    const hazardEl = evt.target.closest(".hazard");
    const topEventEl = evt.target.closest(".top-event");

    if (cardEl && cardEl.classList.contains("link-target") && !mod) {
      evt.preventDefault();
      toggleProtection(cardEl);
      return;
    }

    if (mod) {
      if (barrierEl) {
        enterLinkMode(barrierEl.dataset.barrierId);
        return;
      }
      if (cardEl && !ui.activeBarrierId) {
        toggleCardSelection(cardEl);
        return;
      }
      if (topEventEl && !ui.activeBarrierId) {
        selectComponent(topEventEl);
        return;
      }
      if (hazardEl && !ui.activeBarrierId) {
        selectComponent(hazardEl);
        return;
      }
    }

    if (barrierEl && !evt.target.closest(".id-tag, .desc-text")) {
      enterLinkMode(barrierEl.dataset.barrierId);
      return;
    }

    if (cardEl && !ui.activeBarrierId && !evt.target.closest(".id-tag, .desc-text")) {
      selectComponent(cardEl);
      return;
    }

    if (topEventEl && !ui.activeBarrierId && !evt.target.closest(".desc-text")) {
      evt.preventDefault();
      beginFieldEdit(topEventEl, "description");
      return;
    }

    if (hazardEl && !ui.activeBarrierId && !evt.target.closest(".desc-text")) {
      evt.preventDefault();
      beginFieldEdit(hazardEl, "description");
      return;
    }

    if (ui.activeBarrierId) exitLinkMode();
    else clearComponentSelection();

    if (!barrierEl && !cardEl && !hazardEl && !topEventEl) {
      // True empty-canvas click: nothing under the pointer was a component.
      // Chromium's contenteditable caret hit-testing can still snap focus into
      // a nearby desc-text/id-tag field in sparse grid gaps (e.g. the split
      // barrier gap) even though elementFromPoint confirms no node was hit —
      // blur it so the click reads as a plain deselect, not a text-edit open.
      const active = document.activeElement;
      if (active && active !== document.body && active.isContentEditable) {
        active.blur();
      }
    }
  });

  document.addEventListener(
    "keydown",
    (evt) => {
      if (evt.key === "Tab") blurNavigation = "tab";
    },
    true
  );

  document.addEventListener("keydown", (evt) => {
    const active = document.activeElement;

    if (active?.isContentEditable) {
      if (evt.key === "Escape") {
        evt.preventDefault();
        blurNavigation = "cancel";
        cancelEditSession();
        const component = active.closest(".card, .barrier, .hazard, .top-event");
        active.blur();
        if (component) {
          clearComponentSelection();
          setKeyboardNavTarget(component, { select: false });
        }
        return;
      }

      if (evt.key === "Enter") {
        const isDesc = active.classList.contains("desc-text");
        if (isDesc && evt.shiftKey && !(evt.metaKey || evt.ctrlKey)) return;
        evt.preventDefault();
        blurNavigation = "apply";
        applyEditSession();
        active.blur();
        const component = active.closest(".card, .barrier, .hazard, .top-event");
        if (evt.metaKey || evt.ctrlKey) {
          if (component?.classList.contains("barrier")) {
            enterLinkMode(component.dataset.barrierId);
          } else if (component) {
            selectComponent(component);
          }
        } else {
          finishEditingAfterApply(active);
        }
      }
      return;
    }

    if (evt.key === "Enter" && !evt.shiftKey) {
      if (handleEnterOnComponent(evt)) return;
    }

    if (evt.key === "Escape") {
      if (ui.activeBarrierId) cancelLinkMode();
      else if (selectionLayoutDirty) cancelCardLayoutChanges();
      else clearComponentSelection();
    }
  });

  document.addEventListener("keydown", (evt) => {
    if (evt.key !== "Backspace") return;
    if (document.activeElement && document.activeElement.isContentEditable) return;

    if (ui.activeBarrierId) {
      evt.preventDefault();
      deleteBarrierGroup(ui.activeBarrierId);
      return;
    }

    if (
      selectedFocusDomId &&
      selectedFocusDomId !== "hazard" &&
      selectedFocusDomId !== "top-event" &&
      findCardByDomId(selectedFocusDomId)
    ) {
      evt.preventDefault();
      const toDelete =
        ui.selectedIds.size > 1
          ? Array.from(ui.selectedIds).filter((id) => findCardByDomId(id))
          : [selectedFocusDomId];
      clearComponentSelection();
      toDelete.forEach((domId) => deleteCard(domId));
    }
  });

  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.addEventListener("click", () => runAction(btn));
  });

  document.addEventListener("keydown", (evt) => {
    if (document.activeElement && document.activeElement.isContentEditable) return;
    if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
    const key = evt.key.toLowerCase();
    const btn = document.querySelector(`.action-btn[data-shortcut="${key}"]`);
    if (!btn) return;
    evt.preventDefault();
    runAction(btn);
  });

  // ---------- Pan ----------

  function setSpacePanArmed(armed) {
    spacePanArmed = armed;
    bowtieWrap?.classList.toggle("is-space-pan", armed);
    if (!armed && isPanning) endPan();
  }

  function beginPan(clientX, clientY) {
    if (!bowtieWrap) return;
    isPanning = true;
    panLast = { x: clientX, y: clientY };
    bowtieWrap.classList.add("is-panning");
  }

  function movePan(clientX, clientY) {
    if (!isPanning || !bowtieWrap) return;
    const dx = clientX - panLast.x;
    const dy = clientY - panLast.y;
    panLast = { x: clientX, y: clientY };
    bowtieWrap.scrollLeft -= dx;
    bowtieWrap.scrollTop -= dy;
  }

  function endPan() {
    if (!isPanning) return;
    isPanning = false;
    bowtieWrap?.classList.remove("is-panning");
    ignoreClickAfterPan = true;
  }

  bowtieWrap?.addEventListener(
    "click",
    (evt) => {
      if (!ignoreClickAfterPan) return;
      ignoreClickAfterPan = false;
      evt.preventDefault();
      evt.stopPropagation();
    },
    true
  );

  bowtieWrap?.addEventListener("mousedown", (evt) => {
    if (!spacePanArmed || evt.button !== 0) return;
    evt.preventDefault();
    beginPan(evt.clientX, evt.clientY);
  });

  window.addEventListener("mousemove", (evt) => {
    if (isPanning) {
      evt.preventDefault();
      movePan(evt.clientX, evt.clientY);
    }
  });

  window.addEventListener("mouseup", () => {
    endPan();
  });

  document.addEventListener("keydown", (evt) => {
    if (evt.code !== "Space" && evt.key !== " ") return;
    if (document.activeElement && document.activeElement.isContentEditable) return;
    evt.preventDefault();
    if (!evt.repeat) setSpacePanArmed(true);
  });

  document.addEventListener("keyup", (evt) => {
    if (evt.code === "Space" || evt.key === " ") setSpacePanArmed(false);
  });

  window.addEventListener("blur", () => {
    setSpacePanArmed(false);
  });

  // ---------- Init ----------

  state = hydrateFromDom();
  render(state);
  buildConnectors();

  const importStateInput = document.getElementById("import-state-file");
  if (importStateInput) {
    importStateInput.addEventListener("change", () => {
      const file = importStateInput.files?.[0];
      if (file) importStateFromFile(file);
      importStateInput.value = "";
    });
  }

  window.addEventListener("resize", () => {
    fitAllBarrierDescriptions();
    positionAllConnectors();
  });

  const ro = new ResizeObserver(() => {
    fitAllBarrierDescriptions();
    positionAllConnectors();
  });
  [zoneLeft, zoneCenter, zoneRight, bowtie].forEach((n) => ro.observe(n));
})();
