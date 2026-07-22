/**
 * Penpot MCP execute_code — import Bowtie mode/light + mode/dark token sets.
 * Run with the target file connected (HFA DS first, then each consumer).
 * Keeps token key names identical to hfa-ds/tokens.json.
 */
(function importBowtieTokens() {
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
    { type: "color", name: "foreground.muted", value: "#57606A" },
    { type: "color", name: "foreground.subtle", value: "#8B949E" },
    { type: "color", name: "brand.primary", value: "#D70000" },
    { type: "color", name: "brand.primary.subtle", value: "#FFE5E5" },
    { type: "color", name: "brand.on_primary", value: "#FFFFFF" },
    { type: "color", name: "brand.secondary", value: "#B30000" },
    { type: "color", name: "brand.on_secondary", value: "#FFFFFF" },
    { type: "color", name: "brand.tertiary", value: "#870000" },
    { type: "color", name: "brand.on_tertiary", value: "#FFFFFF" },
    { type: "color", name: "brand.inverted", value: "#FF4444" },
    { type: "color", name: "brand.on_inverted", value: "#FFFFFF" },
    { type: "borderRadius", name: "radius.round", value: "999" },
    { type: "fontFamilies", name: "roboto-base", value: ["Source Sans 3"] },
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
    { type: "color", name: "foreground.muted", value: "#C9D1D9" },
    { type: "color", name: "foreground.subtle", value: "#9CA3AF" },
    { type: "color", name: "brand.primary", value: "#FF4444" },
    { type: "color", name: "brand.primary.subtle", value: "#3D1515" },
    { type: "color", name: "brand.on_primary", value: "#FFFFFF" },
    { type: "color", name: "brand.secondary", value: "#FF6666" },
    { type: "color", name: "brand.on_secondary", value: "#FFFFFF" },
    { type: "color", name: "brand.tertiary", value: "#FF8888" },
    { type: "color", name: "brand.on_tertiary", value: "#0D1117" },
    { type: "color", name: "brand.inverted", value: "#D70000" },
    { type: "color", name: "brand.on_inverted", value: "#FFFFFF" },
    { type: "fontFamilies", name: "roboto-base", value: ["Source Sans 3"] },
    { type: "number", name: "shared_tokens.line_styles.strong", value: "2" },
    { type: "number", name: "shared_tokens.line_styles.weak", value: "0.5" },
    { type: "number", name: "shared_tokens.line_styles.normal", value: "1" },
  ];

  function replaceLegacyBackground(set) {
    const legacy = set.tokens.find((t) => t.name === "background" && t.type === "color");
    if (!legacy) return null;
    const value = legacy.value;
    legacy.remove();
    set.addToken({ type: "color", name: "background.base", value });
    return value;
  }

  function ensureSet(name) {
    const catalog = penpot.library.local.tokens;
    let set = catalog.sets.find((s) => s.name === name);
    if (!set) set = catalog.addSet({ name });
    if (!set.active) set.toggleActive();
    return set;
  }

  function upsertTokens(set, defs) {
    const added = [];
    const updated = [];
    const skipped = [];
    for (const def of defs) {
      let t = set.tokens.find((x) => x.name === def.name && x.type === def.type);
      if (!t) {
        try {
          set.addToken({ type: def.type, name: def.name, value: def.value });
          added.push(def.name);
        } catch (e) {
          skipped.push({ name: def.name, type: def.type, error: String(e).slice(0, 140) });
        }
      } else if (t.value !== def.value) {
        t.value = def.value;
        updated.push(def.name);
      }
    }
    return { added, updated, skipped };
  }

  const file = penpot.currentFile?.name;
  const lightSet = ensureSet("mode/light");
  const darkSet = ensureSet("mode/dark");
  const renamedLegacy = {
    light: replaceLegacyBackground(lightSet),
    dark: replaceLegacyBackground(darkSet),
  };
  const lightResult = upsertTokens(lightSet, lightTokens);
  const darkResult = upsertTokens(darkSet, darkTokens);

  const globalSet = penpot.library.local.tokens.sets.find((s) => s.name === "Global");
  if (globalSet && globalSet.active) globalSet.toggleActive();

  const catalog = penpot.library.local.tokens;
  let lightTheme = catalog.themes.find((t) => t.name === "Light");
  let darkTheme = catalog.themes.find((t) => t.name === "Dark");
  if (!lightTheme) lightTheme = catalog.addTheme("Mode", "Light");
  if (!darkTheme) darkTheme = catalog.addTheme("Mode", "Dark");
  try {
    lightTheme.addSet(lightSet);
  } catch (_) {}
  try {
    darkTheme.addSet(darkSet);
  } catch (_) {}
  if (darkSet.active) darkSet.toggleActive();
  if (!lightSet.active) lightSet.toggleActive();
  if (!lightTheme.active) lightTheme.toggleActive();

  return {
    file,
    step: "01-import-bowtie-tokens",
    renamedLegacy,
    lightResult,
    darkResult,
    globalDeactivated: !!globalSet,
    activeSets: catalog.sets.filter((s) => s.active).map((s) => s.name),
    activeThemes: catalog.themes.filter((t) => t.active).map((t) => t.name),
    tokenOverview: penpotUtils.tokenOverview(),
  };
})();
