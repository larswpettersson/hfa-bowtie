(function () {
  const bowtie = document.getElementById("bowtie");
  const zoneLeft = document.getElementById("zone-left");
  const zoneCenter = document.getElementById("zone-center");
  const zoneRight = document.getElementById("zone-right");
  const connectorsLayer = bowtie.querySelector(".connectors-layer");

  let state = null;
  const ui = { activeBarrierId: null, selectedIds: new Set(), selectionAnchorId: null };
  let selectedFocusDomId = null;

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

    const hazardEl = document.querySelector(".hazard .id-tag, .hazard [contenteditable]");
    const topEventEl = document.querySelector(".top-event .id-tag, .top-event [contenteditable]");

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
        id: hazardEl?.id?.replace(/^id-/, "") || "HZ",
        label: hazardEl ? readEditableText(hazardEl) : "Hazard",
      },
      topEvent: {
        id: topEventEl?.id?.replace(/^id-/, "") || "TE",
        label: topEventEl ? readEditableText(topEventEl) : "Top Event",
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

  function wireDescriptionEditing(el, getFull, setFull) {
    if (el.dataset.editingWired) return;
    el.dataset.editingWired = "1";

    const full = getFull();
    el.dataset.full = full;
    applyDescriptionTruncation(el, full);
    fitBarrierDescription(el);

    el.addEventListener("focus", () => {
      const value = getFull();
      el.dataset.full = value;
      writeEditableText(el, value);
    });

    el.addEventListener("input", () => {
      const value = readEditableText(el);
      el.dataset.full = value;
      setFull(value);
    });

    el.addEventListener("blur", () => {
      setFull(readEditableText(el));
      commit(() => {});
    });
  }

  function wireIdTagEditing(el, getId, setId) {
    if (el.dataset.idWired) return;
    el.dataset.idWired = "1";

    el.addEventListener("input", () => {
      const value = readEditableText(el);
      setId(value);
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
      setId(readEditableText(el));
      commit(() => {});
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

  function renderCenter(s) {
    document.body.dataset.theme = s.meta.theme;
    document.querySelectorAll('[data-action="setTheme"]').forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.themeValue === s.meta.theme);
    });

    const hazardTag = document.getElementById(`id-${s.hazard.id}`);
    if (hazardTag && hazardTag !== document.activeElement) {
      writeEditableText(hazardTag, s.hazard.label);
    }
    if (hazardTag) {
      wireDescriptionEditing(
        hazardTag,
        () => s.hazard.label,
        (value) => {
          s.hazard.label = value;
        }
      );
    }

    const topTag = document.getElementById(`id-${s.topEvent.id}`);
    if (topTag && topTag !== document.activeElement) {
      writeEditableText(topTag, s.topEvent.label);
    }
    if (topTag) {
      wireDescriptionEditing(
        topTag,
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
          connectorsLayer.append(lineA, lineB);

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
      connectorsLayer.append(line);
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

  function clearComponentSelection() {
    ui.selectedIds.forEach((domId) => {
      if (domId === "hazard") document.querySelector(".hazard")?.classList.remove("is-selected");
      else if (domId === "top-event") document.querySelector(".top-event")?.classList.remove("is-selected");
      else document.getElementById(domId)?.classList.remove("is-selected");
    });
    ui.selectedIds.clear();
    ui.selectionAnchorId = null;
    selectedFocusDomId = null;
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
  }

  function extendSelection(direction) {
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
  }

  function enterLinkMode(barrierId) {
    if (ui.activeBarrierId === barrierId) return;
    exitLinkMode();
    clearComponentSelection();
    const side = barrierSide(barrierId);
    const barrier = side ? findBarrier(barrierId, side) : null;
    if (barrier) {
      const leaves = side === "left" ? state.left.causes : state.right.consequences;
      barrier.authoredSegments = computeBarrierSegments(barrier, leaves);
    }
    ui.activeBarrierId = barrierId;
    applyLinkModeUI();
    render(state);
    buildConnectors();
  }

  function exitLinkMode() {
    if (!ui.activeBarrierId) return;
    const prevBarrierId = ui.activeBarrierId;
    const side = barrierSide(prevBarrierId);
    const barrier = side ? findBarrier(prevBarrierId, side) : null;
    if (barrier) {
      const leaves = side === "left" ? state.left.causes : state.right.consequences;
      barrier.authoredSegments = computeBarrierSegments(barrier, leaves);
    }
    ui.activeBarrierId = null;
    document.body.classList.remove("linking-mode");
    document.querySelectorAll(".card.link-target").forEach((card) => {
      card.classList.remove("link-target", "is-selected", "is-unaffected");
    });
    getBarrierSegmentEls(prevBarrierId).forEach((seg) => seg.classList.remove("is-selected"));
    commit(() => {});
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
      ui.activeBarrierId = null;
      document.body.classList.remove("linking-mode");

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

    const legendRow = document.querySelector(`.legend-row[data-shortcut="${evt.key.toLowerCase()}"]`);
    if (legendRow) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      applyLegendRow(ui.activeBarrierId, legendRow);
    }
  });

  document.addEventListener("keydown", (evt) => {
    if (!selectedFocusDomId || !findCardByDomId(selectedFocusDomId)) return;
    if (document.activeElement && document.activeElement.isContentEditable) return;
    if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
    if (evt.key !== "ArrowUp" && evt.key !== "ArrowDown") return;

    evt.preventDefault();
    evt.stopImmediatePropagation();
    const direction = evt.key === "ArrowUp" ? -1 : 1;
    if (evt.shiftKey) {
      extendSelection(direction);
    } else if (ui.selectedIds.size <= 1) {
      moveCardRow(selectedFocusDomId, direction);
    }
  });

  document.addEventListener("mousedown", (evt) => {
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

    if (topEventEl && !ui.activeBarrierId && !evt.target.closest(".id-tag, .desc-text")) {
      selectComponent(topEventEl);
      return;
    }

    if (hazardEl && !ui.activeBarrierId && !evt.target.closest(".id-tag, .desc-text")) {
      selectComponent(hazardEl);
      return;
    }

    if (ui.activeBarrierId) exitLinkMode();
    else clearComponentSelection();
  });

  document.addEventListener("keydown", (evt) => {
    if (evt.key !== "Enter" || !(evt.metaKey || evt.ctrlKey)) return;
    const active = document.activeElement;
    if (!active || !active.isContentEditable) return;
    evt.preventDefault();
    const component = active.closest(".card, .barrier, .hazard, .top-event");
    active.blur();
    selectComponent(component);
  });

  document.addEventListener("keydown", (evt) => {
    if (evt.key !== "Escape") return;

    const active = document.activeElement;
    if (active && active.isContentEditable) {
      const component = active.closest(".card, .barrier, .hazard, .top-event");
      active.blur();
      selectComponent(component);
      return;
    }

    if (ui.activeBarrierId) exitLinkMode();
    else clearComponentSelection();
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

  // ---------- Init ----------

  state = hydrateFromDom();
  render(state);
  buildConnectors();

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
