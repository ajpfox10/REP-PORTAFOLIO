"""
Catalogo de campos de SiAPe (Oracle Forms) a partir de los mapas JAB guardados.

Lee:
  siape_map_*.json            (map_siape_jab.py / siape_capturar_pantalla.py)
  siape_map_*/NNN_*.json      (siape_observador_jab.py)
y genera:
  siape_catalogo/catalogo.json   -> una entrada por pantalla (frame interno + pestana activa)
  siape_catalogo/CATALOGO.md     -> lo mismo legible

SiAPe NO expone los nombres internos BLOQUE.ITEM (probado con record=names en el
jnlp: el servidor lo ignora), asi que cada campo se identifica por:
  - name de JAB (= prompt del item) cuando lo tiene,
  - fila/columna si es parte de una grilla multi-registro,
  - para los SIN NOMBRE: columna/vecinos, etiqueta cercana, valor visto al capturar
    y bounds RELATIVOS al frame interno (no a la pantalla) -> sobreviven a mover la ventana.
"""
import glob
import json
import re
from collections import defaultdict
from pathlib import Path

AQUI = Path(__file__).resolve().parent
SALIDA = AQUI / "siape_catalogo"

ROLES_CAMPO = {"text", "password text", "combo box", "check box", "radio button",
               "push button", "toggle button", "list", "table", "page tab"}
ROLES_CONT = {"internal frame", "dialog", "option pane", "alert"}
VISIBLE = {"mostrando", "showing"}
SELECCION = {"seleccionado", "selected"}
TOOLBAR_Y_MAX = 90   # barra de herramientas de Forms (Guardar, Enter Query...) arriba de todo


def _b(n):
    b = n.get("bounds") or {}
    return b.get("x", -1), b.get("y", -1), b.get("width", -1), b.get("height", -1)


def _visible(n):
    x, y, w, h = _b(n)
    st = set(n.get("states") or [])
    return w > 0 and h > 0 and bool(st & VISIBLE or not st)


def _contiene(c, n):
    cx, cy, cw, ch = _b(c)
    x, y, w, h = _b(n)
    mx, my = x + w / 2, y + h / 2
    return cx <= mx <= cx + cw and cy <= my <= cy + ch


def _limpio(s):
    return re.sub(r"\s+", " ", (s or "").strip())


def _ident(n):
    """Identidad del campo: la `description` de JAB si la tiene (en Forms es el
    nombre de la columna/prompt y NO cambia con el foco; el `name` del campo
    enfocado viene ensuciado con ' X tab page ...'), si no el `name`."""
    return _limpio(n.get("description")) or _limpio(n.get("name"))


def cargar_mapas():
    """[(origen, [nodo normalizado])]"""
    out = []
    for f in sorted(glob.glob(str(AQUI / "siape_map_*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        out.append((Path(f).name, d.get("controls") or []))
    for f in sorted(glob.glob(str(AQUI / "siape_map_*" / "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        out.append((f"{Path(f).parent.name}/{Path(f).name}", d.get("nodos") or []))
    return out


def _ancestro_frame(n, por_id):
    """Frame interno real (por parent_id). None si la cadena esta cortada."""
    vistos = 0
    p = por_id.get(n.get("parent_id"))
    while p is not None and vistos < 80:
        if p.get("role") in ROLES_CONT:
            return p
        p = por_id.get(p.get("parent_id"))
        vistos += 1
    return None


def pantallas_de(nodos):
    """Agrupa los campos visibles por frame interno: el ancestro real si el mapa
    trae parent_id; si no (observador), el frame mas chico que los contiene."""
    por_id = {n["id"]: n for n in nodos if n.get("id") is not None}
    # orden de "arriba hacia abajo": el frame activo primero, despues el orden del
    # recorrido (en el JDesktopPane de Forms el hijo 0 es el de adelante)
    conts = [n for n in nodos if n.get("role") in ROLES_CONT and _visible(n)]
    orden = {id(c): i for i, c in enumerate(conts)}
    conts.sort(key=lambda c: (not ({"activo", "active"} & set(c.get("states") or [])), orden[id(c)]))
    grupos = defaultdict(list)
    for n in nodos:
        if n.get("role") not in ROLES_CAMPO or not _visible(n):
            continue
        if _b(n)[3] <= 4:            # nodos tecnicos de 1-3 px (cursor de Forms)
            continue
        if _b(n)[0] < -1000 or _b(n)[1] < -1000:   # items que Forms esconde fuera de pantalla
            continue
        cont = _ancestro_frame(n, por_id) if por_id else None
        if cont is not None and not _visible(cont):
            continue                  # campo de un frame tapado/minimizado
        n["_exacto"] = cont is not None
        if cont is None:
            cont = next((c for c in conts if _contiene(c, n)), None)
        if cont is None:
            if _b(n)[1] < TOOLBAR_Y_MAX:
                grupos[("(barra de herramientas)", 0, 0)].append(n)
            continue
        cx, cy, _, _ = _b(cont)
        nombre = _limpio(cont.get("name")) or "(frame sin titulo)"
        grupos[(nombre, cx, cy)].append(n)
    return grupos


def detectar_grillas(campos):
    """Columnas = mismo rol/x/ancho/alto repetido >=3 veces en y distintas.
    Devuelve {id(nodo): (col_key, fila)} y la lista de columnas ordenada por x."""
    por_col = defaultdict(list)
    for n in campos:
        if n.get("role") == "page tab":
            continue
        x, y, w, h = _b(n)
        por_col[(n.get("role"), x, w, h)].append(n)
    asign, cols = {}, []
    for k, ns in por_col.items():
        ys = sorted({_b(n)[1] for n in ns})
        if len(ys) < 3:
            continue
        pasos = {ys[i + 1] - ys[i] for i in range(len(ys) - 1)}
        if max(pasos) - min(pasos) > 3:
            continue
        cols.append(k)
        for n in ns:
            asign[id(n)] = (k, ys.index(_b(n)[1]) + 1)
    cols.sort(key=lambda k: k[1])
    return asign, cols


def nombre_col(k, campos, asign):
    nombres = [_ident(n) for n in campos if asign.get(id(n), (None,))[0] == k]
    nombres = [x for x in nombres if x]
    return nombres[0] if nombres else ""


def inferir(n, campos, asign, cols, fx, fy):
    """Etiqueta + como se infirio, para un campo sin nombre."""
    x, y, w, h = _b(n)
    txt = _limpio(n.get("text"))
    if id(n) in asign:
        k, fila = asign[id(n)]
        i = cols.index(k)
        izq = next((nombre_col(c, campos, asign) for c in reversed(cols[:i]) if nombre_col(c, campos, asign)), "")
        der = next((nombre_col(c, campos, asign) for c in cols[i + 1:] if nombre_col(c, campos, asign)), "")
        if w <= 20:
            return "indicador de registro (marca la fila actual)", "grilla: columna de 16px a la izquierda", fila
        return f"columna sin nombre entre [{izq or 'borde'}] y [{der or 'borde'}]", "grilla: posicion de columna", fila
    if n.get("role") == "list":
        return "lista de valores (LOV): elegir opcion por texto", "rol list sin nombre", None
    if re.fullmatch(r"\d{1,2}", txt) and w <= 30:
        return "celda de dia del calendario (buscar por valor = dia)", "valor numerico 1-31", None
    if re.fullmatch(r"\d{2}-\d{2}-\d{4}", txt):
        return "fecha elegida en el calendario (dd-mm-aaaa)", "valor con formato fecha", None
    if txt.upper().startswith("MINISTERIO DE SALUD"):
        return "encabezado de sesion (organismo - usuario logueado)", "valor 'MINISTERIO DE SALUD...'", None
    if w >= 900 and h >= 20:
        return "linea de ayuda de Forms (hint del item con foco)", "ancho completo al pie", None
    m = re.match(r"^([A-Za-zÁÉÍÓÚÑáéíóúñ .\-/]{3,40}?)\s*:", txt)
    if m:
        return f"{m.group(1).strip()} (campo display)", "valor visto: prefijo 'Etiqueta:'", None
    # etiqueta (role label) a la izquierda en la misma linea o justo arriba
    labels = [l for l in campos if l.get("role") == "label" and _ident(l)]
    mejor = None
    for l in labels:
        lx, ly, lw, lh = _b(l)
        misma = abs((ly + lh / 2) - (y + h / 2)) <= h / 2 and lx + lw <= x + 4
        arriba = 0 <= y - (ly + lh) <= 30 and lx < x + w and lx + lw > x
        if misma or arriba:
            d = (x - (lx + lw)) if misma else (y - ly) + 1000
            if mejor is None or d < mejor[0]:
                mejor = (d, _ident(l))
    if mejor:
        return mejor[1], "etiqueta cercana", None
    # campo con nombre a la izquierda en la misma linea
    vec = [c for c in campos if c is not n and _ident(c) and c.get("role") != "push button"
           and abs((_b(c)[1] + _b(c)[3] / 2) - (y + h / 2)) <= h / 2 and _b(c)[0] + _b(c)[2] <= x + 4]
    if vec:
        v = max(vec, key=lambda c: _b(c)[0])
        return f"a la derecha de [{_limpio(v.get('name'))}]", "vecino en la misma linea", None
    vec = [c for c in campos if c is not n and _ident(c) and c.get("role") != "push button"
           and abs((_b(c)[1] + _b(c)[3] / 2) - (y + h / 2)) <= h / 2 and _b(c)[0] >= x + w - 4]
    if vec:
        v = min(vec, key=lambda c: _b(c)[0])
        return f"a la izquierda de [{_limpio(v.get('name'))}]", "vecino en la misma linea", None
    if txt:
        return f"display (valor: '{txt[:40]}')", "solo por valor visto", None
    return f"sin referencia (zona x={x - fx}, y={y - fy})", "solo por posicion", None


def catalogar():
    pantallas = {}
    for origen, nodos in cargar_mapas():
        tabs_sel = {}
        for (fname, fx, fy), campos in pantallas_de(nodos).items():
            sel = sorted({_limpio(t.get("name")) for t in campos
                          if t.get("role") == "page tab" and set(t.get("states") or []) & SELECCION})
            clave = fname + (f" :: pestana {' / '.join(sel)}" if sel else "")
            p = pantallas.setdefault(clave, {"frame": fname, "pestanas_activas": sel, "origenes": [],
                                             "campos": {}})
            if origen not in p["origenes"]:
                p["origenes"].append(origen)
            asign, cols = detectar_grillas(campos)
            nombres_rep = defaultdict(int)
            for n in campos:
                nombres_rep[(n.get("role"), _ident(n))] += 1
            for n in sorted(campos, key=lambda n: (_b(n)[1], _b(n)[0])):
                x, y, w, h = _b(n)
                rx, ry = x - fx, y - fy
                nom = _ident(n)
                fila = asign.get(id(n), (None, None))[1]
                if nom:
                    etiqueta, como = nom, "name JAB"
                    if _limpio(n.get("description")):
                        como = "description JAB"
                    if fila:
                        como = "description JAB + fila de grilla" if _limpio(n.get("description")) else "name JAB + fila de grilla"
                    elif nombres_rep[(n.get("role"), nom)] > 1:
                        como = "name JAB repetido: desempatar por posicion"
                else:
                    etiqueta, como, f2 = inferir(n, campos, asign, cols, fx, fy)
                    fila = fila or f2
                col_x = asign[id(n)][0][1] - fx if id(n) in asign else None
                # en grillas se guarda una sola entrada por columna (fila 1) + cantidad de filas
                if fila and fila > 1:
                    k = f"{n.get('role')}|{etiqueta}|col{col_x}"
                    if k in p["campos"]:
                        p["campos"][k]["filas"] = max(p["campos"][k]["filas"], fila)
                    continue
                if fila:
                    k = f"{n.get('role')}|{etiqueta}|col{col_x}"
                elif not nom:
                    k = f"{n.get('role')}|SN|{rx},{ry},{w}"
                else:
                    k = f"{n.get('role')}|{etiqueta}|{rx},{ry}"
                previo = p["campos"].get(k)
                if previo and not nom and RANGO.get(como, 9) < RANGO.get(previo["identificado_por"], 9):
                    previo["etiqueta"], previo["identificado_por"] = etiqueta, como
                e = p["campos"].setdefault(k, {
                    "rol": n.get("role"), "name_jab": nom, "desc_jab": _limpio(n.get("description")), "etiqueta": etiqueta, "identificado_por": como,
                    "sin_nombre": not nom, "grilla": bool(fila), "filas": 1 if fila else None,
                    "rel": {"x": rx, "y": ry, "w": w, "h": h}, "valores_vistos": [],
                    "exacto": False,
                })
                e["exacto"] = e["exacto"] or bool(n.get("_exacto"))
                v = _limpio(n.get("text"))
                if v and v not in e["valores_vistos"] and len(e["valores_vistos"]) < 3 and n.get("role") != "password text":
                    e["valores_vistos"].append(v[:60])
    for p in pantallas.values():
        campos = list(p["campos"].values())
        # si la pantalla tiene captura exacta (cadena de padres), lo asignado solo
        # por geometria en mapas viejos sobra: suelen ser campos de un frame de atras
        if any(e["exacto"] for e in campos):
            campos = [e for e in campos if e["exacto"]]
        p["exacta"] = any(e["exacto"] for e in campos)
        p["campos"] = sorted(campos, key=lambda e: (e["rel"]["y"], e["rel"]["x"]))
    return pantallas


RANGO = {"rol list sin nombre": 0, "valor numerico 1-31": 0, "valor con formato fecha": 0,
         "valor 'MINISTERIO DE SALUD...'": 0, "ancho completo al pie": 0, "valor visto: prefijo 'Etiqueta:'": 1, "etiqueta cercana": 2,
         "vecino en la misma linea": 3, "solo por valor visto": 4, "solo por posicion": 5}


def localizador(e):
    r = e["rel"]
    if e.get("desc_jab") and e["identificado_por"] == "description JAB":
        return f"role='{e['rol']}', description='{e['desc_jab']}'"
    if e["name_jab"] and e["identificado_por"] == "name JAB":
        return f"role='{e['rol']}', name='{e['name_jab']}'"
    if e["grilla"]:
        base = (f"description='{e['desc_jab']}'" if e.get("desc_jab") else f"name='{e['name_jab']}'") if e["name_jab"] else f"rel_x={r['x']}, w={r['w']}"
        return f"role='{e['rol']}', {base}, fila=N (orden por y)"
    if e["name_jab"]:
        return f"role='{e['rol']}', name='{e['name_jab']}', rel=({r['x']},{r['y']})"
    return f"role='{e['rol']}', rel=({r['x']},{r['y']},{r['w']}x{r['h']}) ±6"


def escribir(pantallas):
    SALIDA.mkdir(exist_ok=True)
    for p in pantallas.values():
        for e in p["campos"]:
            e["localizar"] = localizador(e)
    (SALIDA / "catalogo.json").write_text(json.dumps(pantallas, ensure_ascii=False, indent=1), encoding="utf-8")
    L = ["# Catalogo de campos SiAPe", "",
         "Generado por `siape_catalogo.py` desde los mapas JAB. Coordenadas **relativas al frame interno**.",
         "SiAPe no expone nombres BLOQUE.ITEM (record=names ignorado por el server): los sin nombre se ubican por grilla/vecino/valor/posicion.",
         ""]
    for clave in sorted(pantallas):
        p = pantallas[clave]
        sn = sum(1 for e in p["campos"] if e["sin_nombre"])
        tipo = "captura exacta (arbol JAB)" if p.get("exacta") else "solo mapas viejos: asignado por geometria"
        L += [f"## {clave}", "", f"{len(p['campos'])} campos ({sn} sin nombre) · fuentes: {len(p['origenes'])} · {tipo}", "",
              "| rol | etiqueta | identificado por | grilla | rel x,y,w,h | localizar | valor visto |",
              "|---|---|---|---|---|---|---|"]
        for e in p["campos"]:
            r = e["rel"]
            g = f"{e['filas']} filas" if e["grilla"] else ""
            et = ("**" + e["etiqueta"] + "**") if e["sin_nombre"] else e["etiqueta"]
            L.append(f"| {e['rol']} | {et} | {e['identificado_por']} | {g} | {r['x']},{r['y']},{r['w']},{r['h']} | "
                     f"`{e['localizar']}` | {' / '.join(e['valores_vistos'])[:70].replace('|', '/')} |")
        L.append("")
    (SALIDA / "CATALOGO.md").write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    pant = catalogar()
    escribir(pant)
    tot = sum(len(p["campos"]) for p in pant.values())
    sn = sum(1 for p in pant.values() for e in p["campos"] if e["sin_nombre"])
    print(f"{len(pant)} pantallas, {tot} campos, {sn} sin nombre -> {SALIDA}")
