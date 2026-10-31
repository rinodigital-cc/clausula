"""
Gera o wordmark provisório “ApoIA Seguro” em curvas (SVG), a partir da
Inter Display (OFL). Uso: python3 scripts/brand/gerar-wordmark.py <pasta-saida>

- “ApoIA” em SemiBold; o I usa a variante com serifa (cv08) para não ser
  lido como l. “IA” recebe a cor de destaque.
- “Seguro” em Regular, separado por um espaço óptico.
"""
import sys, os
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONTS = "/usr/share/fonts/opentype/inter"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."

def shape(path, text, features):
    blob = hb.Blob.from_file_path(path)
    face = hb.Face(blob); font = hb.Font(face)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, features)
    return buf.glyph_infos, buf.glyph_positions

def outline(path, text, features, x0, tracking=0):
    tt = TTFont(path); gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
    infos, pos = shape(path, text, features)
    out = []; x = x0
    for i, p in zip(infos, pos):
        name = order[i.codepoint]
        pen = SVGPathPen(gs)
        # y para baixo no SVG: inverte o eixo; linha de base em y = 0
        tp = TransformPen(pen, (1, 0, 0, -1, x + p.x_offset, -p.y_offset))
        gs[name].draw(tp)
        d = pen.getCommands()
        if d: out.append(d)
        x += p.x_advance + tracking
    return out, x

UPM = 2048  # Inter: 2048 unidades por eme
SB = f"{FONTS}/InterDisplay-SemiBold.otf"
RG = f"{FONTS}/InterDisplay-Regular.otf"
TRK = -0.02 * UPM  # espaçamento −2%

apo, x1 = outline(SB, "Apo", {"kern": True}, 0, TRK)
ia, x2 = outline(SB, "IA", {"kern": True, "cv08": True}, x1 + 0.01 * UPM, TRK)
gap = 0.27 * UPM
seg, x3 = outline(RG, "Seguro", {"kern": True}, x2 + gap, TRK * 0.5)

capH, desc = 1490, 420  # altura de maiúscula e descendente (g)
top = -capH - 60
h = capH + desc + 100
w = x3
def svg(cA, cIA, cS, title="ApoIA Seguro"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {top:.0f} {w:.0f} {h:.0f}" role="img" aria-label="{title}">'
            f'<title>{title}</title>'
            f'<g fill="{cA}"><path d="{" ".join(apo)}"/></g>'
            f'<g fill="{cIA}"><path d="{" ".join(ia)}"/></g>'
            f'<g fill="{cS}"><path d="{" ".join(seg)}"/></g></svg>')

os.makedirs(OUT, exist_ok=True)
variants = {
    "wordmark.svg": ("#12305C", "#2F6BE0", "#12305C"),
    "wordmark-reverso.svg": ("#FFFFFF", "#8DB8FF", "#FFFFFF"),
    "wordmark-preto.svg": ("#000000", "#000000", "#000000"),
    "wordmark-branco.svg": ("#FFFFFF", "#FFFFFF", "#FFFFFF"),
}
for f, c in variants.items():
    open(os.path.join(OUT, f), "w").write(svg(*c))
# dados para o componente React
import json
json.dump({"viewBox": f"0 {top:.0f} {w:.0f} {h:.0f}", "apo": " ".join(apo), "ia": " ".join(ia), "seg": " ".join(seg),
           "ratio": round(w / h, 4)}, open(os.path.join(OUT, "wordmark.json"), "w"))
print("ok", round(w / h, 3))
