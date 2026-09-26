"""Builds resources/icons/open-editor-groups.woff, the icon font that holds the
vertical project color bar glyph used in the tree view.

The glyph is referenced from package.json (`contributes.icons`) so it can be used
as a ThemeIcon and tinted with a ThemeColor, which SVG icons cannot be.

Requires: pip install fonttools
Run:      npm run build:icons
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPEM = 1024  # units per em; VS Code renders icons at 16px, so 64 units = 1px
PX = UPEM / 16

# Same geometry as the Visual Studio tab bar: a thin pill, 3.5px wide, 14px tall.
BAR_WIDTH = 3.5 * PX
BAR_HEIGHT = 14 * PX
BAR_X = (UPEM - BAR_WIDTH) / 2
BAR_Y = (UPEM - BAR_HEIGHT) / 2

CODEPOINT = 0xE001
GLYPH_NAME = "bar"
FAMILY = "open-editor-groups"


def draw_pill(pen: TTGlyphPen, x: float, y: float, w: float, h: float) -> None:
    """Draws a vertically oriented pill (rounded rectangle with fully round ends)."""
    r = w / 2
    k = 0.5522847498 * r  # cubic-to-quadratic-friendly control offset
    x0, x1 = x, x + w
    y0, y1 = y, y + h
    cx = x + r
    # Start at the left edge above the bottom cap, go clockwise (TrueType: clockwise = filled).
    pen.moveTo((x0, y0 + r))
    pen.lineTo((x0, y1 - r))
    # top cap: left -> top-center -> right
    pen.qCurveTo((x0, y1 - r + k), (cx - k, y1), (cx, y1))
    pen.qCurveTo((cx + k, y1), (x1, y1 - r + k), (x1, y1 - r))
    pen.lineTo((x1, y0 + r))
    # bottom cap: right -> bottom-center -> left
    pen.qCurveTo((x1, y0 + r - k), (cx + k, y0), (cx, y0))
    pen.qCurveTo((cx - k, y0), (x0, y0 + r - k), (x0, y0 + r))
    pen.closePath()


def main() -> None:
    out_dir = Path(__file__).resolve().parent.parent / "resources" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{FAMILY}.woff"

    notdef_pen = TTGlyphPen(None)
    bar_pen = TTGlyphPen(None)
    draw_pill(bar_pen, BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT)

    glyphs = {".notdef": notdef_pen.glyph(), GLYPH_NAME: bar_pen.glyph()}

    fb = FontBuilder(UPEM, isTTF=True)
    fb.setupGlyphOrder([".notdef", GLYPH_NAME])
    fb.setupCharacterMap({CODEPOINT: GLYPH_NAME})
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({".notdef": (UPEM, 0), GLYPH_NAME: (UPEM, int(BAR_X))})
    # Ascent = full em, descent = 0: the glyph box then lines up with the 16px icon box.
    fb.setupHorizontalHeader(ascent=UPEM, descent=0)
    fb.setupNameTable({"familyName": FAMILY, "styleName": "Regular", "psName": FAMILY})
    fb.setupOS2(sTypoAscender=UPEM, sTypoDescender=0, sTypoLineGap=0, usWinAscent=UPEM, usWinDescent=0)
    fb.setupPost()
    fb.font.flavor = "woff"
    fb.save(str(out_file))
    print(f"wrote {out_file} ({out_file.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
