#!/usr/bin/env python3
"""Static + logic smoke tests for penpot5 state refactor (no browser required)."""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PENPOT5 = ROOT / "penpot5.html"
PROTOTYPE4 = ROOT / "prototype4.html"
APP_JS = ROOT / "scripts" / "penpot5-app.js"


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

    html = PENPOT5.read_text(encoding="utf-8")
    js = APP_JS.read_text(encoding="utf-8")
    p4 = parse_bowtie(PROTOTYPE4)
    p5 = parse_bowtie(PENPOT5)

    def test_files_exist() -> None:
        assert PENPOT5.is_file()
        assert APP_JS.is_file()
        assert PROTOTYPE4.is_file()

    def test_penpot5_loads_app_script() -> None:
        assert_contains("penpot5.html", html, '<script src="scripts/penpot5-app.js"></script>')
        assert_not_contains("penpot5.html", html, "const leftState")

    def test_initial_dom_parity() -> None:
        assert len(p5.causes) == len(p4.causes) == 3
        assert len(p5.consequences) == len(p4.consequences) == 2
        assert len(p5.barriers) == len(p4.barriers) == 5

    def test_state_api_present() -> None:
        for fn in (
            "hydrateFromDom",
            "validateState",
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

    def test_prototype4_unchanged() -> None:
        assert_contains("prototype4.html", PROTOTYPE4.read_text(encoding="utf-8"), "const leftState")

    print("penpot5 smoke tests")
    for fn in (
        test_files_exist,
        test_penpot5_loads_app_script,
        test_initial_dom_parity,
        test_state_api_present,
        test_removed_dom_hacks,
        test_contiguous_runs,
        test_barrier_segments_non_contiguous,
        test_barrier_segments_contiguous,
        test_prototype4_unchanged,
    ):
        check(fn)

    if errors:
        print(f"\n{len(errors)} failed")
        return 1
    print("\nAll smoke tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
