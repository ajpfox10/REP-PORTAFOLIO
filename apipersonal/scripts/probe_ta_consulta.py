# -*- coding: utf-8 -*-
"""Sonda READ-ONLY: abre Tiempo Acumulado y vuelca menus/toolbar (push buttons,
menu items) para encontrar el control de CONSULTAR (modo query) que trae los
registros existentes de una persona. No carga nada. Cierra TA al final."""
import time
import cargar_stress_jab as R
import cargar_francos_siape as F
from cargar_francos_siape import log


def dump_frame(frame, etiqueta):
    log(f"   === {etiqueta}: push buttons / menu items / toggles ===")
    n = 0
    vistos = set()
    for el, d, info in F._jab_walk(root=frame, max_depth=22, max_segundos=40):
        rol = (info.get("role") or "").strip()
        if rol not in ("push button", "menu item", "menu", "toggle button", "check box"):
            continue
        nom = (info.get("name") or "").strip()
        desc = (info.get("description") or "").strip()
        key = (rol, nom, desc)
        if key in vistos:
            continue
        vistos.add(key)
        b = info.get("bounds") or {}
        log(f"      {rol} | name='{nom}' | desc='{desc}' | {b}")
        n += 1
    log(f"   total controles distintos = {n}")


def main():
    F.asegurar_sesion(); R.cerrar_modales()
    log("Barra de menu principal (SIAPE):")
    w = F._buscar_ventana_siape()
    # menu bar del frame externo
    try:
        for el, d, info in F._jab_walk(max_depth=8, max_segundos=20):
            rol = (info.get("role") or "").strip()
            if rol in ("menu", "menu item"):
                nom = (info.get("name") or "").strip()
                if nom:
                    log(f"   MENU {rol} | '{nom}'")
    except Exception as e:
        log(f"   (menu bar: {e})")

    frame = R.abrir_ta()
    if not frame:
        log("No pude abrir TA"); return
    R.cerrar_modales()
    dump_frame(frame, "Tiempo Acumulado (recien abierto, sin persona)")
    log("Cierro TA (descarto)...")
    try:
        R._recuperar()
    except Exception as e:
        log(f"   (_recuperar: {e})"); R.cerrar_modales()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        log(f"ERROR: {e}")
        for l in traceback.format_exc().splitlines():
            log(f"   {l}")
