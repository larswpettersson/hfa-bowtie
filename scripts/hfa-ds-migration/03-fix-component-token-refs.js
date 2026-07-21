/**
 * Penpot MCP execute_code — rebind broken legacy token names on HFA DS Components page.
 * Run with HFA DS connected after 01-import-bowtie-tokens.js.
 */
(function fixComponentTokenRefs() {
  const catalog = penpot.library.local.tokens;

  function findToken(name) {
    for (const set of catalog.sets) {
      const t = set.tokens.find((x) => x.name === name);
      if (t) return t;
    }
    return null;
  }

  const ALIAS = {
    background: "background.base",
    foreground: "foreground.base",
    Normal: "normal",
    Strong: "strong",
    "symbol-text": "roboto-base",
  };

  const page = penpotUtils.getPageByName("Components");
  penpot.openPage(page.id);

  let rebound = 0;
  const skipped = [];

  for (const shape of penpotUtils.findShapes(() => true, page.root)) {
    if (!shape.tokens) continue;
    for (const [prop, rawName] of Object.entries(shape.tokens)) {
      if (!rawName || findToken(rawName)) continue;
      const target = ALIAS[rawName];
      if (!target) {
        skipped.push(rawName);
        continue;
      }
      const token = findToken(target);
      if (!token) {
        skipped.push(rawName + "->" + target);
        continue;
      }
      shape.applyToken(token, [prop]);
      rebound++;
    }
  }

  const broken = {};
  for (const s of penpotUtils.findShapes(() => true, page.root)) {
    if (!s.tokens) continue;
    for (const v of Object.values(s.tokens)) {
      if (!v) continue;
      const exists = catalog.sets.some((set) => set.tokens.some((t) => t.name === v));
      if (!exists) broken[v] = (broken[v] || 0) + 1;
    }
  }

  return {
    file: penpot.currentFile?.name,
    step: "03-fix-component-token-refs",
    rebound,
    skipped: [...new Set(skipped)],
    brokenRefs: broken,
    allResolved: Object.keys(broken).length === 0,
  };
})();
