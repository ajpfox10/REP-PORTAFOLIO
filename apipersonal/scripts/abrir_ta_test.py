# -*- coding: utf-8 -*-
"""Prueba aislada: abrir Tiempo Acumulado por ACCION JAB pura (sin coordenadas).
Prueba 3 formas y reporta cual abrio el frame."""
import time
from pyjab.jabdriver import JABDriver
from pyjab.jabelement import JABElement
from collections import deque

TITLE = "Sistema Unico Provincial de Administracion de Personal"
BRIDGE = r"C:\Program Files\Java\jre1.8.0_333\bin\WindowsAccessBridge-64.dll"


def drv():
    return JABDriver(title=TITLE, bridge_dll=BRIDGE, timeout=12)


def children(el):
    for i in range(el.children_count):
        try:
            acc = el.bridge.getAccessibleChildFromContext(el.vmid, el.accessible_context, i)
            yield JABElement(el.bridge, el.hwnd, el.vmid, acc)
        except Exception:
            continue


def walk(max_depth=14, max_nodes=6000):
    root = drv().root_element
    seen = set()
    q = deque([(root, 0)])
    while q and len(seen) < max_nodes:
        el, d = q.popleft()
        try:
            cid = int(getattr(el.accessible_context, "value", el.accessible_context))
            if cid in seen:
                continue
            seen.add(cid)
            info = el.get_element_information()
        except Exception:
            continue
        yield el, d, info
        if d < max_depth:
            for c in children(el):
                q.append((c, d + 1))


def buscar(**pred):
    prefer_visible = pred.pop("prefer_visible", False)
    encontrado = None
    for el, _d, info in walk():
        if info.get("role") != "menu item":
            continue
        if not (info.get("name") or "").startswith("Tiempo Acumulado"):
            continue
        b = info.get("bounds") or {}
        vis = (b.get("x") or -1) > 0 and (b.get("width") or 0) > 0
        if prefer_visible and not vis:
            encontrado = encontrado or el
            continue
        return el, info
    return encontrado, None


def frame_abierto():
    for el, _d, info in walk(max_depth=12):
        if info.get("role") == "internal frame" and (info.get("name") or "") == "Administración de Tiempo Acumulado":
            b = info.get("bounds") or {}
            if (b.get("width") or 0) > 0:
                return True
    return False


def probar(nombre, hacer):
    print(f"\n== {nombre} ==", flush=True)
    try:
        hacer()
    except Exception as e:
        print(f"  fallo: {e}", flush=True)
        return False
    time.sleep(3)
    ok = frame_abierto()
    print(f"  frame abierto? {ok}", flush=True)
    return ok


def main():
    # A: accion pura sobre el item (sin abrir menu)
    def a():
        el, _ = buscar()
        if not el:
            raise RuntimeError("no encuentro el item")
        el.click(simulate=False)
    if probar("A: click(simulate=False) sobre item (menu cerrado)", a):
        print("\n>>> GANA A"); return

    # B: abrir Novedades por accion, luego item visible por accion
    def b():
        men = drv().find_element_by_name("Novedades ALT N", visible=True)
        men.click(simulate=False)
        time.sleep(1.2)
        el, _ = buscar(prefer_visible=True)
        if not el:
            raise RuntimeError("no encuentro item visible")
        el.click(simulate=False)
    if probar("B: abrir Novedades (accion) + item (accion)", b):
        print("\n>>> GANA B"); return

    # C: abrir Novedades (accion) + item visible por simulate
    def c():
        men = drv().find_element_by_name("Novedades ALT N", visible=True)
        men.click(simulate=False)
        time.sleep(1.2)
        el, _ = buscar(prefer_visible=True)
        el.click(simulate=True)
    if probar("C: abrir Novedades (accion) + item (simulate)", c):
        print("\n>>> GANA C"); return

    print("\n>>> ninguna abrio", flush=True)


if __name__ == "__main__":
    main()
