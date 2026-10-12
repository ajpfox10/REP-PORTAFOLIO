"""
Ubicar campos de SiAPe por el catalogo (siape_catalogo/catalogo.json).

Pensado para que los robots pidan un campo por su ETIQUETA del catalogo en vez de
coordenadas sueltas en el codigo:

    import siape_campos as SC
    el, info = SC.campo("Novedades de Ausentismo :: pestana COMPENSATORIOS", "Fecha", fila=1)
    el, info = SC.campo("Novedades de Ausentismo :: pestana COMPENSATORIOS",
                        "linea de ayuda de Forms (hint del item con foco)")

Como lo encuentra:
  - con name JAB  -> mismo rol + name; si hay varios, el de la fila pedida (grilla)
                     o el mas cercano a la posicion relativa catalogada.
  - sin name      -> mismo rol + posicion RELATIVA al frame interno (+-tolerancia)
                     y ancho parecido; en grillas, columna por x y fila por y.
Solo lee el arbol: hacer click/tipear sigue siendo cosa del robot.

`python siape_campos.py "<pantalla>"` verifica en vivo que cada campo del
catalogo de esa pantalla se encuentra (SiAPe tiene que estar en esa pantalla).
"""
import json
import re
import sys
from functools import lru_cache
from pathlib import Path

import cargar_francos_siape as F

CATALOGO = Path(__file__).resolve().parent / "siape_catalogo" / "catalogo.json"


@lru_cache(maxsize=1)
def catalogo():
    return json.loads(CATALOGO.read_text(encoding="utf-8"))


def entrada(pantalla, etiqueta, rol=None):
    p = catalogo().get(pantalla)
    if not p:
        raise KeyError(f"Pantalla no catalogada: {pantalla!r}")
    cands = [e for e in p["campos"] if e["etiqueta"] == etiqueta and (rol is None or e["rol"] == rol)]
    if not cands:
        raise KeyError(f"{pantalla!r} no tiene el campo {etiqueta!r}")
    return p["frame"], cands[0]


def _b(info):
    b = info.get("bounds") or {}
    return b.get("x", -1), b.get("y", -1), b.get("width", -1), b.get("height", -1)


def _frame(nombre, max_segundos=15):
    """Internal frame visible por nombre RECORTADO (JAB los trae con espacios al
    final); si hay varios, el activo y despues el mas grande."""
    matches = []
    for el, _d, info in F._jab_walk(max_depth=12, max_segundos=max_segundos):
        if info.get("role") not in ("internal frame", "dialog"):
            continue
        if re.sub(r"\s+", " ", (info.get("name") or "").strip()) != nombre:
            continue
        x, y, w, h = _b(info)
        if w <= 0 or h <= 0:
            continue
        activo = 1 if {"activo", "active"} & set(info.get("states") or []) else 0
        matches.append((activo, w * h, el, info))
    if not matches:
        raise LookupError(f"No encuentro el frame '{nombre}' abierto en SiAPe")
    _a, _ar, el, info = max(matches, key=lambda m: (m[0], m[1]))
    return el, info


MAX_DESVIO = 40   # px: un campo con nombre (no grilla) tiene que estar cerca de donde se catalogo


def _limpio(t):
    return re.sub(r"\s+", " ", (t or "").strip())


def _coincide(e, info, fx, fy, tol):
    if info.get("role") != e["rol"] or not F._jab_visible_bounds(info):
        return False
    x, y, w, h = _b(info)
    r = e["rel"]
    nom, desc = _limpio(info.get("name")), _limpio(info.get("description"))
    if e.get("desc_jab"):
        if desc != e["desc_jab"]:      # description no cambia con el foco; el name si
            return False
    elif e["name_jab"]:
        if nom != e["name_jab"]:
            return False
    elif nom or desc:
        return False
    if e["grilla"]:
        return abs((x - fx) - r["x"]) <= tol and abs(w - r["w"]) <= tol
    if not e["name_jab"]:
        return abs((x - fx) - r["x"]) <= tol and abs((y - fy) - r["y"]) <= tol and abs(w - r["w"]) <= tol
    return abs((x - fx) - r["x"]) + abs((y - fy) - r["y"]) <= MAX_DESVIO


def _elegir(e, cands, fila, fx, fy):
    if not cands:
        return None, None
    if e["grilla"]:
        cands.sort(key=lambda c: _b(c[1])[1])
        return cands[fila - 1] if 0 < fila <= len(cands) else (None, None)
    r = e["rel"]
    return min(cands, key=lambda c: abs(_b(c[1])[0] - fx - r["x"]) + abs(_b(c[1])[1] - fy - r["y"]))


def varios(pantalla, pedidos, frame=None, tol=8, max_segundos=30):
    """Varios campos en UN solo recorrido de la pantalla.
    pedidos = [(etiqueta, rol, fila), ...] -> {etiqueta: (el, info) o (None, None)}"""
    ents = [(etq, entrada(pantalla, etq, rol)[1], fila) for etq, rol, fila in pedidos]
    fel, finfo = frame or _frame(catalogo()[pantalla]["frame"])
    fx, fy, _, _ = _b(finfo)
    cands = {etq: [] for etq, _e, _f in ents}
    for el, _d, info in F._jab_walk(root=fel, max_depth=30, max_segundos=max_segundos, max_nodes=8000):
        for etq, e, _f in ents:
            if _coincide(e, info, fx, fy, tol):
                cands[etq].append((el, info))
    return {etq: _elegir(e, cands[etq], fila, fx, fy) for etq, e, fila in ents}


def campo(pantalla, etiqueta, fila=1, rol=None, tol=8, frame=None):
    """(el, info) del campo, o (None, None). `frame` = (el, info) ya buscado, para no re-buscarlo."""
    _fname, e = entrada(pantalla, etiqueta, rol)
    return varios(pantalla, [(etiqueta, e["rol"], fila)], frame=frame, tol=tol)[etiqueta]


def verificar(pantalla):
    """Prueba en vivo cada campo catalogado de la pantalla (read-only)."""
    p = catalogo()[pantalla]
    fr = _frame(p["frame"])
    ok = mal = 0
    for e in p["campos"]:
        if e["rol"] == "page tab":
            continue
        el, info = campo(pantalla, e["etiqueta"], rol=e["rol"], frame=fr)
        if el is None:
            mal += 1
            print(f"  NO  {e['rol']:12} {e['etiqueta']}")
        else:
            ok += 1
    print(f"{pantalla}: {ok} encontrados, {mal} no")
    return mal == 0


if __name__ == "__main__":
    verificar(sys.argv[1])
