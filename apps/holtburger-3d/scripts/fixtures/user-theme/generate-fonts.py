"""Original diagnostic font: one rectangle glyph with two distinct advances.

Regenerate with fontTools (FontBuilder and TTGlyphPen). No third-party glyphs or
font data are included. Distributed under this repository's AGPL-3.0-only license.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

for advance in (500, 900):
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(['.notdef', 'A'])
    builder.setupCharacterMap({65: 'A'})
    pen = TTGlyphPen(None)
    pen.moveTo((50, 0))
    pen.lineTo((350, 0))
    pen.lineTo((350, 700))
    pen.lineTo((50, 700))
    pen.closePath()
    empty = TTGlyphPen(None).glyph()
    builder.setupGlyf({'.notdef': empty, 'A': pen.glyph()})
    builder.setupHorizontalMetrics({'.notdef': (advance, 0), 'A': (advance, 50)})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': 'Theme Probe', 'styleName': 'Regular', 'uniqueFontIdentifier': f'ThemeProbe-{advance}', 'fullName': f'Theme Probe {advance}', 'psName': f'ThemeProbe-{advance}'})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.setupMaxp()
    builder.save(Path(__file__).parent / f'probe-{advance}.ttf')
