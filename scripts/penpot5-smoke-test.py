#!/usr/bin/env python3
"""Static + logic smoke tests for penpot5 state refactor (no browser required)."""

from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BOWTIE_HTML = ROOT / "Bowtie.html"
APP_JS = ROOT / "scripts" / "penpot5-app.js"
TRAFFIC_BROKEN = ROOT / "fixtures" / "bowtie-traffic-event-broken.json"
TRAFFIC_FIXED = ROOT / "fixtures" / "bowtie-traffic-event.json"


def compute_contiguous_runs(sorted_rows: list[int]) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start = None
    prev = None
    for row in sorted_rows:
        if start is None:
            start = row
        elif row != prev + 1:
            runs.append((start, prev))
            start = row
        prev = row
    if start is not None:
        runs.append((start, prev))
    return runs


def compute_barrier_segments(protects: list[str], leaves: list[dict]) -> list[dict]:
    rows = sorted(
        {
            leaf["row"]
            for leaf in leaves
            if leaf["idTagId"] in protects
        }
    )
    if not rows:
        return [{"row": 1, "rowSpan": 1}]
    return [
        {"row": start, "rowSpan": end - start + 1}
        for start, end in compute_contiguous_runs(rows)
    ]


def max_seq_from_ids(prefix: str, items: list[dict]) -> int:
    pattern = re.compile(rf"^{prefix}(\d+)$", re.IGNORECASE)
    max_seq = 0
    for item in items:
        match = pattern.match(str(item.get("id", "")))
        if match:
            max_seq = max(max_seq, int(match.group(1)))
    return max_seq


def normalize_imported_state(raw: dict[str, Any]) -> dict[str, Any]:
    """Mirror penpot5-app.js normalizeImportedState (subset used by validation tests)."""
    s = json.loads(json.dumps(raw))
    s.pop("version", None)

    s.setdefault("meta", {})
    s["meta"].setdefault("seq", {})
    s.setdefault("hazard", {"id": "HZ", "label": "Hazard"})
    s.setdefault("topEvent", {"id": "TE", "label": "Top Event"})
    s.setdefault("left", {"rows": 1, "barrierCols": 0, "causes": [], "barriers": []})
    s.setdefault("right", {"rows": 1, "barrierCols": 0, "consequences": [], "barriers": []})
    s["left"].setdefault("causes", [])
    s["left"].setdefault("barriers", [])
    s["right"].setdefault("consequences", [])
    s["right"].setdefault("barriers", [])

    def normalize_card(card: dict[str, Any]) -> None:
        if not card.get("id"):
            raise ValueError("Card missing id")
        card.setdefault("domId", f"c-{card['id']}")
        card.setdefault("idTagId", f"id-{card['id']}")
        card["description"] = card.get("description", "")
        card["row"] = int(card.get("row") or 1)
        card.setdefault("connectorTarget", f"id-{s['topEvent']['id']}")

    for card in s["left"]["causes"]:
        normalize_card(card)
    for card in s["right"]["consequences"]:
        normalize_card(card)

    s["left"]["rows"] = max(int(s["left"].get("rows") or 1), *[c["row"] for c in s["left"]["causes"]], 1)
    s["right"]["rows"] = max(
        int(s["right"].get("rows") or 1),
        *[c["row"] for c in s["right"]["consequences"]],
        1,
    )

    def normalize_barrier(barrier: dict[str, Any], leaves: list[dict], side: str) -> None:
        if not barrier.get("barrierId"):
            raise ValueError("Barrier missing barrierId")
        barrier.setdefault("id", str(barrier["barrierId"]).upper())
        barrier["description"] = barrier.get("description", "")
        default_col = 2 if side == "left" else 1
        barrier["col"] = int(barrier.get("col") or default_col)
        barrier.setdefault("strength", "Normal")
        barrier.setdefault("status", "Unknown")
        barrier["protects"] = list(barrier.get("protects") or [])
        barrier["everLinked"] = bool(barrier.get("everLinked") or barrier["protects"])
        barrier["authoredSegments"] = compute_barrier_segments(barrier["protects"], leaves)

    for barrier in s["left"]["barriers"]:
        normalize_barrier(barrier, s["left"]["causes"], "left")
    for barrier in s["right"]["barriers"]:
        normalize_barrier(barrier, s["right"]["consequences"], "right")

    s["left"]["barrierCols"] = max(
        int(s["left"].get("barrierCols") or 0),
        max((b["col"] for b in s["left"]["barriers"]), default=0) - 1 if s["left"]["barriers"] else 0,
    )
    s["right"]["barrierCols"] = max(
        int(s["right"].get("barrierCols") or 0),
        max((b["col"] for b in s["right"]["barriers"]), default=0) if s["right"]["barriers"] else 0,
    )

    seq = s["meta"]["seq"]
    seq.setdefault("cause", max_seq_from_ids("C", s["left"]["causes"]))
    seq.setdefault("consequence", max_seq_from_ids("K", s["right"]["consequences"]))
    seq.setdefault("preventiveBarrier", max_seq_from_ids("P", s["left"]["barriers"]))
    seq.setdefault("reactiveBarrier", max_seq_from_ids("R", s["right"]["barriers"]))

    return s


def validate_import_state(s: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    """Mirror penpot5-app.js validateImportState."""
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    def push_error(path: str, message: str, fix: str) -> None:
        errors.append({"path": path, "message": message, "fix": fix})

    def push_warning(path: str, message: str, fix: str) -> None:
        warnings.append({"path": path, "message": message, "fix": fix})

    if not s.get("hazard", {}).get("id"):
        push_error("hazard.id", "Hazard id is required.", 'Set hazard.id (e.g. "HZ").')
    if not s.get("topEvent", {}).get("id"):
        push_error("topEvent.id", "Top event id is required.", 'Set topEvent.id (e.g. "TE").')

    top_event_id_tag = f"id-{s['topEvent']['id']}" if s.get("topEvent", {}).get("id") else None

    for index, cause in enumerate(s["left"]["causes"]):
        path = f"left.causes[{index}]"
        if not cause.get("id"):
            push_error(f"{path}.id", "Cause missing id.", "Add a unique id such as C1.")
        if cause.get("row", 1) < 1 or cause.get("row", 1) > s["left"]["rows"]:
            push_error(
                f"{path} ({cause.get('id', '?')}).row",
                f"Row {cause.get('row')} is outside left.rows (1..{s['left']['rows']}).",
                f"Set row between 1 and {s['left']['rows']}, or increase left.rows.",
            )
        if top_event_id_tag and cause.get("connectorTarget") and cause["connectorTarget"] != top_event_id_tag:
            push_warning(
                f"{path} ({cause.get('id')}).connectorTarget",
                f'connectorTarget is "{cause["connectorTarget"]}" but top event is "{top_event_id_tag}".',
                f'Set connectorTarget to "{top_event_id_tag}".',
            )

    for index, consequence in enumerate(s["right"]["consequences"]):
        path = f"right.consequences[{index}]"
        if not consequence.get("id"):
            push_error(f"{path}.id", "Consequence missing id.", "Add a unique id such as K1.")
        if consequence.get("row", 1) < 1 or consequence.get("row", 1) > s["right"]["rows"]:
            push_error(
                f"{path} ({consequence.get('id', '?')}).row",
                f"Row {consequence.get('row')} is outside right.rows (1..{s['right']['rows']}).",
                f"Set row between 1 and {s['right']['rows']}, or increase right.rows.",
            )

    leaf_id_tag_ids = {
        *(c["idTagId"] for c in s["left"]["causes"]),
        *(c["idTagId"] for c in s["right"]["consequences"]),
    }

    left_max_col = s["left"]["barrierCols"] + 1
    seen_left_barrier_ids: dict[str, int] = {}
    for index, barrier in enumerate(s["left"]["barriers"]):
        path = f"left.barriers[{index}]"
        label = barrier.get("id") or barrier.get("barrierId") or "?"
        barrier_id = barrier.get("barrierId")
        if not barrier_id:
            push_error(f"{path}.barrierId", "Preventive barrier missing barrierId.", 'Add barrierId (e.g. "p1").')
        elif barrier_id in seen_left_barrier_ids:
            push_error(
                f"{path}.barrierId",
                f'Duplicate barrierId "{barrier_id}" on the left side (also at index {seen_left_barrier_ids[barrier_id]}).',
                "Use one barrier object per barrierId; merge authoredSegments instead of splitting.",
            )
        else:
            seen_left_barrier_ids[barrier_id] = index

        col = barrier.get("col", 2)
        if col < 2:
            push_error(
                f"{path} ({label}).col",
                f"col={col} is invalid for preventive barrier {label}: column 1 is reserved for causes.",
                f"Set {label}.col to 2 for the innermost preventive barrier, 3 for the next column toward the top event, etc.",
            )
        elif col > left_max_col:
            push_error(
                f"{path} ({label}).col",
                f"col={col} exceeds the left grid (max {left_max_col} when left.barrierCols={s['left']['barrierCols']}).",
                f"Increase left.barrierCols to at least {col - 1}, or reduce {label}.col.",
            )

        if barrier.get("everLinked") and not barrier.get("protects"):
            push_error(
                f"{path} ({label}).protects",
                f"{label} has everLinked=true but protects is empty — it will render with no cause links.",
                'Add cause idTagIds to protects (e.g. ["id-C1","id-C2"]) matching linked causes.',
            )
        elif not barrier.get("everLinked") and not barrier.get("protects"):
            push_warning(
                f"{path} ({label}).protects",
                f"{label} has no protects links and everLinked=false.",
                "Link the barrier to at least one cause via protects, or set everLinked=true once linked.",
            )

        for id_tag_id in barrier.get("protects", []):
            if id_tag_id not in leaf_id_tag_ids:
                push_error(
                    f"{path} ({label}).protects",
                    f'Unknown idTagId "{id_tag_id}" in protects.',
                    "Use idTagId values from left.causes (e.g. id-C1), not domId values like c-C1.",
                )

    seen_right_barrier_ids: dict[str, int] = {}
    for index, barrier in enumerate(s["right"]["barriers"]):
        path = f"right.barriers[{index}]"
        label = barrier.get("id") or barrier.get("barrierId") or "?"
        barrier_id = barrier.get("barrierId")
        if not barrier_id:
            push_error(f"{path}.barrierId", "Reactive barrier missing barrierId.", 'Add barrierId (e.g. "r1").')
        elif barrier_id in seen_right_barrier_ids:
            push_error(
                f"{path}.barrierId",
                f'Duplicate barrierId "{barrier_id}" on the right side (also at index {seen_right_barrier_ids[barrier_id]}).',
                "Use one barrier object per barrierId; merge authoredSegments instead of splitting.",
            )
        else:
            seen_right_barrier_ids[barrier_id] = index

        col = barrier.get("col", 1)
        if col < 1 or col > s["right"]["barrierCols"]:
            push_error(
                f"{path} ({label}).col",
                f"col={col} is outside the reactive barrier range 1..{s['right']['barrierCols']}.",
                f"Set {label}.col between 1 and {s['right']['barrierCols']} (consequences occupy col {s['right']['barrierCols'] + 1}).",
            )

        if barrier.get("everLinked") and not barrier.get("protects"):
            push_error(
                f"{path} ({label}).protects",
                f"{label} has everLinked=true but protects is empty.",
                'Add consequence idTagIds to protects (e.g. ["id-K1"]).',
            )

        for id_tag_id in barrier.get("protects", []):
            if id_tag_id not in leaf_id_tag_ids:
                push_error(
                    f"{path} ({label}).protects",
                    f'Unknown idTagId "{id_tag_id}" in protects.',
                    "Use idTagId values from right.consequences (e.g. id-K1).",
                )

    left_cols = [b["col"] for b in s["left"]["barriers"]]
    for index, col in enumerate(left_cols):
        if col in left_cols[:index]:
            label = s["left"]["barriers"][index].get("id") or s["left"]["barriers"][index].get("barrierId")
            push_warning(
                f"left.barriers[{index}] ({label}).col",
                f"Multiple preventive barriers share col={col}.",
                "Assign unique columns: innermost barrier col=2, next col=3, etc.",
            )

    return {"errors": errors, "warnings": warnings}


class BowtieParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.causes: list[str] = []
        self.consequences: list[str] = []
        self.barriers: list[str] = []
        self._card_kind: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {k: v for k, v in attrs if k and v is not None}
        if tag == "article" and attr.get("data-kind") == "cause":
            self.causes.append(attr.get("id", ""))
        if tag == "article" and attr.get("data-kind") == "consequence":
            self.consequences.append(attr.get("id", ""))
        if tag == "div" and "barrier" in (attr.get("class") or "").split():
            self.barriers.append(attr.get("data-barrier-id") or attr.get("id", ""))


def parse_bowtie(path: Path) -> BowtieParser:
    parser = BowtieParser()
    parser.feed(path.read_text(encoding="utf-8"))
    return parser


def assert_contains(name: str, haystack: str, needle: str) -> None:
    if needle not in haystack:
        raise AssertionError(f"{name}: expected to find {needle!r}")


def assert_not_contains(name: str, haystack: str, needle: str) -> None:
    if needle in haystack:
        raise AssertionError(f"{name}: should not contain {needle!r}")


def main() -> int:
    errors: list[str] = []

    def check(fn) -> None:
        try:
            fn()
            print(f"  ok  {fn.__name__}")
        except AssertionError as exc:
            errors.append(str(exc))
            print(f" FAIL {fn.__name__}: {exc}")

    html = BOWTIE_HTML.read_text(encoding="utf-8")
    js = APP_JS.read_text(encoding="utf-8")
    p5 = parse_bowtie(BOWTIE_HTML)

    def test_files_exist() -> None:
        assert BOWTIE_HTML.is_file()
        assert APP_JS.is_file()

    def test_initial_dom_counts() -> None:
        assert len(p5.causes) == 3
        assert len(p5.consequences) == 2
        assert len(p5.barriers) == 5

    def test_penpot5_loads_app_script() -> None:
        assert_contains("Bowtie.html", html, '<script src="scripts/penpot5-app.js"></script>')
        assert_not_contains("Bowtie.html", html, "const leftState")

    def test_initial_dom_parity() -> None:
        assert len(p5.causes) == 3
        assert len(p5.consequences) == 2
        assert len(p5.barriers) == 5

    def test_state_api_present() -> None:
        for fn in (
            "hydrateFromDom",
            "validateState",
            "validateImportState",
            "formatImportValidationMessage",
            "applyState",
            "commit",
            "render(",
            "computeBarrierSegments",
            "computeContiguousRuns",
            "addCause",
            "addConsequence",
            "deleteCard",
            "deleteBarrierGroup",
            "moveCardRow",
            "moveBarrierColumn",
            "toggleProtection",
            "setTheme",
            "serializeState",
            "deserializeState",
            "loadState",
            "exportStateToFile",
        ):
            assert_contains("penpot5-app.js", js, f"function {fn}" if fn.endswith("(") is False else fn)

    def test_removed_dom_hacks() -> None:
        assert_not_contains("penpot5-app.js", js, "function syncBarrierId")
        assert_not_contains("penpot5-app.js", js, "function syncBarrierDescription")
        assert_not_contains("penpot5-app.js", js, "function cloneBarrierSegment")
        assert_not_contains("penpot5-app.js", js, "function resizeBarrierToLinks")
        assert_not_contains("penpot5-app.js", js, "leftState")
        assert_not_contains("penpot5-app.js", js, "rightState")

    def test_contiguous_runs() -> None:
        assert compute_contiguous_runs([1, 2, 3, 5]) == [(1, 3), (5, 5)]
        assert compute_contiguous_runs([2]) == [(2, 2)]

    def test_barrier_segments_non_contiguous() -> None:
        leaves = [
            {"idTagId": "id-C1", "row": 1},
            {"idTagId": "id-C2", "row": 2},
            {"idTagId": "id-C3", "row": 3},
        ]
        segs = compute_barrier_segments(["id-C1", "id-C3"], leaves)
        assert segs == [{"row": 1, "rowSpan": 1}, {"row": 3, "rowSpan": 1}]

    def test_barrier_segments_contiguous() -> None:
        leaves = [
            {"idTagId": "id-C1", "row": 1},
            {"idTagId": "id-C2", "row": 2},
        ]
        segs = compute_barrier_segments(["id-C1", "id-C2"], leaves)
        assert segs == [{"row": 1, "rowSpan": 2}]

    def test_center_components_edit_description() -> None:
        assert_contains("Bowtie.html", html, '<span class="label">Hazard</span>')
        assert_contains("Bowtie.html", html, '<span class="label">Top Event</span>')
        assert_contains('Bowtie.html', html, 'class="desc-text" contenteditable="true" data-role="description"')
        assert_not_contains("Bowtie.html", html, 'class="label id-tag" contenteditable="true"')
        assert_contains("penpot5-app.js", js, 'beginFieldEdit(topEventEl, "description")')
        assert_contains("penpot5-app.js", js, 'beginFieldEdit(hazardEl, "description")')
        assert_contains("penpot5-app.js", js, "syncCenterAnchor")

    def test_json_import_export_ui() -> None:
        assert_contains("Bowtie.html", html, 'data-action="exportState"')
        assert_contains("Bowtie.html", html, 'data-action="importState"')
        assert_contains("Bowtie.html", html, 'id="import-state-file"')

    def test_keyboard_navigation_helpers() -> None:
        for fn in (
            "function getComponentNavKind",
            "function navigateComponents",
            "function getCausesInRowOrder",
            "function getConsequencesInRowOrder",
        ):
            assert_contains("penpot5-app.js", js, fn)
        assert_contains(
            "penpot5-app.js",
            js,
            'setKeyboardNavTarget(component, { select: false })',
        )
        assert_not_contains(
            "penpot5-app.js",
            js,
            "selectComponent(active.closest",
        )

    def test_diagram_fixture_schema() -> None:
        fixture = {
            "version": 1,
            "meta": {
                "theme": "light",
                "seq": {"cause": 1, "preventiveBarrier": 1, "reactiveBarrier": 0, "consequence": 0},
            },
            "hazard": {"id": "HZ", "label": "Hazard"},
            "topEvent": {"id": "TE", "label": "Top Event"},
            "left": {
                "rows": 2,
                "barrierCols": 1,
                "causes": [
                    {
                        "id": "C1",
                        "domId": "c-C1",
                        "idTagId": "id-C1",
                        "description": "Cause one",
                        "row": 1,
                        "connectorTarget": "id-TE",
                    },
                    {
                        "id": "C2",
                        "domId": "c-C2",
                        "idTagId": "id-C2",
                        "description": "Cause two",
                        "row": 2,
                        "connectorTarget": "id-TE",
                    },
                ],
                "barriers": [
                    {
                        "barrierId": "p1",
                        "id": "P1",
                        "description": "Barrier",
                        "col": 2,
                        "strength": "Normal",
                        "status": "Unknown",
                        "protects": ["id-C1", "id-C2"],
                        "everLinked": True,
                        "authoredSegments": [{"row": 1, "rowSpan": 2}],
                    }
                ],
            },
            "right": {"rows": 1, "barrierCols": 0, "consequences": [], "barriers": []},
        }
        for key in ("version", "meta", "hazard", "topEvent", "left", "right"):
            assert key in fixture, f"fixture missing {key}"
        assert len(fixture["left"]["causes"]) == 2
        assert fixture["left"]["barriers"][0]["protects"] == ["id-C1", "id-C2"]
        segs = compute_barrier_segments(
            fixture["left"]["barriers"][0]["protects"],
            fixture["left"]["causes"],
        )
        assert segs == [{"row": 1, "rowSpan": 2}]

    def test_import_validation_blocks_traffic_p1_col() -> None:
        assert TRAFFIC_BROKEN.is_file(), "missing fixtures/bowtie-traffic-event-broken.json"
        raw = json.loads(TRAFFIC_BROKEN.read_text(encoding="utf-8"))
        normalized = normalize_imported_state(raw)
        result = validate_import_state(normalized)
        assert result["errors"], "broken traffic fixture should fail import validation"
        p1_errors = [e for e in result["errors"] if "P1" in e["path"] or "P1" in e["message"]]
        assert p1_errors, "expected a P1 column error"
        assert any("col=1" in e["message"] for e in p1_errors)
        assert any("col to 2" in e["fix"] or "col=2" in e["fix"] for e in p1_errors)

    def test_import_validation_accepts_fixed_traffic_fixture() -> None:
        assert TRAFFIC_FIXED.is_file(), "missing fixtures/bowtie-traffic-event.json"
        raw = json.loads(TRAFFIC_FIXED.read_text(encoding="utf-8"))
        normalized = normalize_imported_state(raw)
        result = validate_import_state(normalized)
        assert not result["errors"], result["errors"]
        p1 = normalized["left"]["barriers"][0]
        p2 = normalized["left"]["barriers"][1]
        assert p1["col"] == 2
        assert p2["col"] == 3

    print("penpot5 smoke tests")
    for fn in (
        test_files_exist,
        test_penpot5_loads_app_script,
        test_initial_dom_counts,
        test_initial_dom_parity,
        test_state_api_present,
        test_removed_dom_hacks,
        test_contiguous_runs,
        test_barrier_segments_non_contiguous,
        test_barrier_segments_contiguous,
        test_keyboard_navigation_helpers,
        test_json_import_export_ui,
        test_diagram_fixture_schema,
        test_import_validation_blocks_traffic_p1_col,
        test_import_validation_accepts_fixed_traffic_fixture,
        test_center_components_edit_description,
    ):
        check(fn)

    if errors:
        print(f"\n{len(errors)} failed")
        return 1
    print("\nAll smoke tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
