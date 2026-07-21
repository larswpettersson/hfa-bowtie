/**
 * Penpot MCP execute_code — file-aware migration orchestrator.
 * Connect each file in order: HFA DS → Bowtie → HTA → STPA → RBD
 */
(function orchestrate() {
  const file = penpot.currentFile?.name;
  const report = { file, steps: [] };

  function ensurePage(name) {
    let page = penpotUtils.getPageByName(name);
    if (!page) {
      page = penpot.createPage();
      page.name = name;
      report.steps.push("created-page:" + name);
    }
    return page;
  }

  function importTokens() {
    const SOURCE_SANS = ["Source Sans 3"];
    const lightTokens = [
      { type: "color", name: "info", value: "#007FFF" },
      { type: "color", name: "success", value: "#228B22" },
      { type: "color", name: "warning", value: "#FFC300" },
      { type: "color", name: "foreground.base", value: "#0D1117" },
      { type: "color", name: "error", value: "#C70039" },
      { type: "color", name: "background.base", value: "#F0F6FC" },
      { type: "color", name: "background.elevated", value: "#FFFFFF" },
      { type: "color", name: "background.sunken", value: "#E6EDF3" },
      { type: "color", name: "background.info", value: "#78A8DB" },
      { type: "color", name: "background.success", value: "#6BAF8A" },
      { type: "color", name: "background.warning", value: "#D4BD52" },
      { type: "color", name: "background.error", value: "#C96B6B" },
      { type: "color", name: "brand.primary", value: "#D70000" },
      { type: "color", name: "brand.on_primary", value: "#FFFFFF" },
      { type: "color", name: "brand.secondary", value: "#B30000" },
      { type: "color", name: "brand.on_secondary", value: "#FFFFFF" },
      { type: "color", name: "brand.tertiary", value: "#870000" },
      { type: "color", name: "brand.on_tertiary", value: "#FFFFFF" },
      { type: "color", name: "brand.inverted", value: "#FF4444" },
      { type: "color", name: "brand.on_inverted", value: "#FFFFFF" },
      { type: "borderRadius", name: "radius.round", value: "999" },
      { type: "fontFamilies", name: "roboto-base", value: SOURCE_SANS },
      { type: "fontSizes", name: "size.normal", value: "14" },
      { type: "number", name: "shared_tokens.line_styles.strong", value: "3" },
      { type: "number", name: "shared_tokens.line_styles.weak", value: "0.5" },
      { type: "number", name: "shared_tokens.line_styles.normal", value: "1" },
      { type: "borderWidth", name: "normal", value: "{shared_tokens.line_styles.normal}" },
      { type: "borderWidth", name: "strong", value: "{shared_tokens.line_styles.strong}" },
    ];
    const darkTokens = [
      { type: "color", name: "foreground.base", value: "#FAFBFC" },
      { type: "color", name: "info", value: "#58A6FF" },
      { type: "color", name: "warning", value: "#FFC300" },
      { type: "color", name: "error", value: "#E03E3E" },
      { type: "color", name: "success", value: "#3FB950" },
      { type: "color", name: "background.base", value: "#2D333B" },
      { type: "color", name: "background.elevated", value: "#383D45" },
      { type: "color", name: "background.sunken", value: "#000000" },
      { type: "color", name: "background.info", value: "#254F7A" },
      { type: "color", name: "background.success", value: "#1A5A42" },
      { type: "color", name: "background.warning", value: "#6B5414" },
      { type: "color", name: "background.error", value: "#602A36" },
      { type: "color", name: "brand.primary", value: "#FF4444" },
      { type: "color", name: "brand.on_primary", value: "#FFFFFF" },
      { type: "color", name: "brand.secondary", value: "#FF6666" },
      { type: "color", name: "brand.on_secondary", value: "#FFFFFF" },
      { type: "color", name: "brand.tertiary", value: "#FF8888" },
      { type: "color", name: "brand.on_tertiary", value: "#0D1117" },
      { type: "color", name: "brand.inverted", value: "#D70000" },
      { type: "color", name: "brand.on_inverted", value: "#FFFFFF" },
      { type: "fontFamilies", name: "roboto-base", value: SOURCE_SANS },
      { type: "number", name: "shared_tokens.line_styles.strong", value: "2" },
      { type: "number", name: "shared_tokens.line_styles.weak", value: "0.5" },
      { type: "number", name: "shared_tokens.line_styles.normal", value: "1" },
    ];

    function ensureSet(name) {
      const catalog = penpot.library.local.tokens;
      let set = catalog.sets.find((s) => s.name === name);
      if (!set) set = catalog.addSet({ name });
      if (!set.active) set.toggleActive();
      return set;
    }

    function upsert(set, defs) {
      let n = 0;
      for (const def of defs) {
        let t = set.tokens.find((x) => x.name === def.name && x.type === def.type);
        if (!t) {
          try {
            set.addToken({ type: def.type, name: def.name, value: def.value });
            n++;
          } catch (_) {}
        } else if (t.value !== def.value) {
          t.value = def.value;
          n++;
        }
      }
      return n;
    }

    const light = ensureSet("mode/light");
    const dark = ensureSet("mode/dark");
    const n = upsert(light, lightTokens) + upsert(dark, darkTokens);
    const globalSet = penpot.library.local.tokens.sets.find((s) => s.name === "Global");
    if (globalSet && globalSet.active) globalSet.toggleActive();
    const catalog = penpot.library.local.tokens;
    if (!catalog.themes.find((t) => t.name === "Light")) catalog.addTheme("Mode", "Light");
    if (!catalog.themes.find((t) => t.name === "Dark")) catalog.addTheme("Mode", "Dark");
    report.steps.push("tokens-updated:" + n);
    return penpotUtils.tokenOverview();
  }

  function listMainComponents(root) {
    return penpotUtils
      .findShapes((s) => typeof s.isMainComponent === "function" && s.isMainComponent(), root)
      .map((s) => ({ name: s.name, id: s.id, isVariantContainer: typeof s.isVariantContainer === "function" && s.isVariantContainer() }));
  }

  if (file === "HFA DS") {
    ensurePage("Foundations");
    ensurePage("Components");
    report.tokenOverview = importTokens();
    report.localComponents = penpot.library.local.components.map((c) => c.name);
    report.next =
      "Copy Bowtie/HTA/STPA main components onto Components page, then File → Publish as shared library.";
  } else if (file === "Bowtie") {
    report.tokenOverview = importTokens();
    const compPage = penpotUtils.getPageByName("Components");
    report.mainComponents = listMainComponents(compPage?.root || penpot.root);
    report.next = "Copy listed mains to HFA DS Components page.";
  } else if (file === "HTA") {
    report.tokenOverview = importTokens();
    const compPage = penpotUtils.getPageByName("Components");
    report.mainComponents = listMainComponents(compPage?.root || penpot.root);
    report.next = "Copy Task + Connector Orthogonal to HFA DS.";
  } else if (file === "STPA") {
    report.tokenOverview = importTokens();
    const compPage = penpotUtils.getPageByName("Components");
    report.mainComponents = listMainComponents(compPage?.root || penpot.root);
    report.next = "Copy Note to HFA DS; then replace local Note with HFA DS library instance.";
  } else if (file === "RBD") {
    report.tokenOverview = importTokens();
    report.localComponents = penpot.library.local.components.map((c) => c.name);
    report.next = "Replace local Toolbar/Card with HFA DS library instances.";
  } else {
    report.next = "Connect a known app file (HFA DS, Bowtie, HTA, STPA, RBD) to MCP.";
  }

  report.pages = penpotUtils.getPages().map((p) => p.name);
  return report;
})();
