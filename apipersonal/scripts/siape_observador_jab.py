"""
Observador pasivo de SIAPE por Java Access Bridge (solo lectura, no clickea).

Cada pocos segundos recorre el arbol JAB; cuando cambia la "firma" de la
pantalla (frames internos visibles, dialogos, menus desplegados, foco) guarda:
  <salida>/NNN_<firma>.txt   -> arbol legible (rol | nombre | desc | bounds | estados)
  <salida>/NNN_<firma>.json  -> mismo arbol en JSON
  <salida>/NNN_<firma>.png   -> captura de la ventana

Uso:  python siape_observador_jab.py --salida siape_map_baja
Cortar con Ctrl+C (o matar el proceso).
"""
import argparse
import json
import re
import time
from collections import deque
from datetime import datetime
from pathlib import Path

VENTANA_SIAPE = "Sistema Unico Provincial de Administracion de Personal"
DLL = r"C:\Program Files\Java\jre1.8.0_333\bin\WindowsAccessBridge-64.dll"
ROLES_FIRMA = {"internal frame", "dialog", "option pane", "popup menu", "alert"}


def driver():
    from pyjab.jabdriver import JABDriver
    return JABDriver(title=VENTANA_SIAPE, bridge_dll=DLL, timeout=10)


def hijos(el):
    from pyjab.jabelement import JABElement
    for i in range(el.children_count):
        try:
            acc = el.bridge.getAccessibleChildFromContext(el.vmid, el.accessible_context, i)
            yield JABElement(el.bridge, el.hwnd, el.vmid, acc)
        except Exception:
            continue


def visible(info):
    b = info.get("bounds") or {}
    st = info.get("states") or []
    return ("visible" in st and "mostrando" in st and (b.get("width") or 0) > 0
            and (b.get("height") or 0) > 0)


def recorrer(root, max_depth=40, max_nodes=6000, max_seg=25):
    """BFS; solo baja por nodos visibles (evita grillas/menus cerrados enormes)."""
    limite = time.time() + max_seg
    nodos, vistos = [], set()
    cola = deque([(root, 0, None)])
    while cola and len(nodos) < max_nodes and time.time() < limite:
        el, d, padre = cola.popleft()
        try:
            ctx = el.accessible_context
            cid = int(getattr(ctx, "value", ctx))
            if cid in vistos:
                continue
            vistos.add(cid)
            info = el.get_element_information()
        except Exception:
            continue
        vis = visible(info)
        if d > 0 and not vis:
            continue
        txt = ""
        if info.get("role") in ("text", "password text", "combo box", "label"):
            try:
                txt = "" if info.get("role") == "password text" else (el.text or "")
            except Exception:
                txt = ""
        nodos.append({
            "id": cid,
            "parent_id": padre,   # para que siape_catalogo.py asigne cada campo a su frame real
            "depth": d,
            "role": info.get("role"),
            "name": info.get("name"),
            "description": info.get("description"),
            "bounds": info.get("bounds"),
            "states": info.get("states"),
            "children": info.get("children_count") if "children_count" in info else None,
            "text": txt[:200],
        })
        if info.get("role") in ("list", "table"):
            # Las LOV de Forms son "manages descendants": los items no vienen
            # como visibles, asi que se leen todos aca sin filtro.
            items = []
            for i, h in enumerate(hijos(el)):
                if i >= 500:
                    break
                try:
                    hi = h.get_element_information()
                    items.append(hi.get("name") or "")
                except Exception:
                    continue
            nodos[-1]["items"] = items
            continue
        if d < max_depth:
            for h in hijos(el):
                cola.append((h, d + 1, cid))
    return nodos


def firma(nodos):
    partes = []
    for n in nodos:
        r = n.get("role") or ""
        st = n.get("states") or []
        if r in ROLES_FIRMA or (r == "menu" and "seleccionado" in st) or \
           (r == "page tab" and "seleccionado" in st):
            partes.append(f"{r}:{n.get('name') or ''}")
    return " | ".join(sorted(set(partes))) or "(sin frames)"


def a_texto(nodos):
    lineas = []
    for n in nodos:
        b = n.get("bounds") or {}
        lineas.append(
            f"{'  ' * n['depth']}{n.get('role')} | {n.get('name') or ''} | "
            f"{n.get('description') or ''} | ({b.get('x')},{b.get('y')},{b.get('width')},{b.get('height')}) | "
            f"{','.join(n.get('states') or [])}" + (f" | txt={n['text']!r}" if n.get("text") else "")
        )
        for it in n.get("items") or []:
            lineas.append(f"{'  ' * (n['depth'] + 1)}- {it}")
    return "\n".join(lineas)


def captura():
    """Captura la ventana ANTES del recorrido (el walk tarda y la LOV se cierra)."""
    try:
        import pygetwindow as gw
        from PIL import ImageGrab
        w = [w for w in gw.getAllWindows() if VENTANA_SIAPE.lower() in (w.title or "").lower()]
        if w and not w[0].isMinimized:
            w = w[0]
            return ImageGrab.grab(bbox=(w.left, w.top, w.right, w.bottom), all_screens=True)
    except Exception as e:
        print("captura fallo:", e)
    return None


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", s)[:80].strip("_") or "pantalla"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default="siape_map_baja")
    ap.add_argument("--intervalo", type=float, default=2.0)
    a = ap.parse_args()
    out = Path(a.salida)
    out.mkdir(parents=True, exist_ok=True)
    log = open(out / "_log.txt", "a", encoding="utf-8")
    drv = None
    ultima = None
    n = len(list(out.glob("*.json")))
    while True:
        try:
            if drv is None:
                drv = driver()
            img = captura()
            nodos = recorrer(drv.root_element)
            f = firma(nodos)
            if f != ultima:
                n += 1
                base = out / f"{n:03d}_{slug(f)}"
                base.with_suffix(".txt").write_text(f"# {datetime.now():%H:%M:%S}  {f}\n\n" + a_texto(nodos), encoding="utf-8")
                base.with_suffix(".json").write_text(json.dumps({"firma": f, "nodos": nodos}, ensure_ascii=False, indent=1), encoding="utf-8")
                if img is not None:
                    img.save(str(base.with_suffix(".png")))
                linea = f"{datetime.now():%H:%M:%S} #{n:03d} {f}  ({len(nodos)} nodos)"
                print(linea, flush=True)
                log.write(linea + "\n"); log.flush()
                ultima = f
        except Exception as e:
            print("error:", e, flush=True)
            drv = None
            time.sleep(3)
        time.sleep(a.intervalo)


if __name__ == "__main__":
    main()
