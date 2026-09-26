"""
Prueba en vivo del flujo de Exportaciones -> Consultas a Exportar.

Selecciona la fila de una consulta por nombre, aprieta Exportar, carga el
periodo (Desde/Hasta) y aprieta ACEPTAR. Objetivo: ver que pasa despues
(dialogo nativo de Windows para guardar, carpeta fija, etc.) para poder
automatizar la descarga real mas adelante. Loguea todo, no asume nada.

Uso:
  python probar_exportacion_siape.py --consulta "Novedades Por Periodo" --desde 22/09/2026 --hasta 22/09/2026 --dry-run
  python probar_exportacion_siape.py --consulta "Novedades Por Periodo" --desde 22/09/2026 --hasta 22/09/2026
"""
import argparse
import sys
import time

import cargar_francos_siape as F
from cargar_francos_siape import (
    log, PAUSA_CORTA, PAUSA_MEDIA, PAUSA_LARGA,
    asegurar_sesion, cerrar_modales,
    _jab_walk, _jab_wait_frame, _jab_find_frame,
    _jab_click_bounds, _jab_set_text_by_bounds, _jab_buscar,
    _bounds_ok,
)


def listar_ventanas_top():
    """Enumera ventanas top-level visibles del SO (para detectar un dialogo
    nativo de guardado, que no aparece en el arbol JAB de SiAPe)."""
    import win32gui

    vistas = []

    def cb(hwnd, _):
        if win32gui.IsWindowVisible(hwnd):
            titulo = win32gui.GetWindowText(hwnd)
            if titulo:
                vistas.append((hwnd, titulo, win32gui.GetClassName(hwnd)))

    win32gui.EnumWindows(cb, None)
    return vistas


def abrir_gestor_exportaciones(timeout=20):
    frame, info = _jab_find_frame("Gestor de Exportaciones", timeout=15, max_segundos=15)
    if frame:
        log("Gestor de Exportaciones ya estaba abierto, lo reuso.")
        return frame, info

    log("Navego a Exportaciones -> Consultas a Exportar...")
    # El menu de nivel superior SIEMPRE tiene bounds validos (esta en la barra).
    # El submenu "Consultas a Exportar" solo tiene bounds validos una vez que el
    # padre esta realmente desplegado: por eso NO se usa _jab_click_menu_item
    # (su fallback clickea items con bounds -1,-1 y eso termina en el icono de
    # la ventana). Se hace en dos pasos, cada uno con bounds reales verificados.
    _, menu_info = _jab_buscar(nombre="Exportaciones ALT E", role="menu", timeout=10)
    if not menu_info:
        log("ERROR: no encontre el menu 'Exportaciones ALT E'.")
        return None, None
    _jab_click_bounds(menu_info)
    time.sleep(PAUSA_MEDIA)

    _, item_info = _jab_buscar(nombre="Consultas a Exportar nemotécnico C",
                                role="menu item", timeout=6)
    if not item_info or not _bounds_ok(item_info):
        log("ERROR: el submenu 'Consultas a Exportar' no desplego bounds validos; "
            "corto sin clickear a ciegas.")
        return None, None
    _jab_click_bounds(item_info)
    return _jab_wait_frame("Gestor de Exportaciones", timeout=timeout)


def fila_consulta(nombre_consulta, timeout=15):
    """Busca la fila cuyo texto en NOMBRE DE LA CONSULTA matchea, devuelve (y, info)."""
    objetivo = nombre_consulta.strip().lower()
    limite = time.time() + timeout
    while time.time() < limite:
        for el, _depth, info in _jab_walk(max_depth=24, max_segundos=8):
            if info.get("role") != "text":
                continue
            if (info.get("name") or "") != "NOMBRE DE LA CONSULTA":
                continue
            if not _bounds_ok(info):
                continue
            texto = (F._jab_read_text(el) or "").strip()
            if texto and texto.strip().lower() == objetivo:
                y = (info.get("bounds") or {}).get("y")
                return y, info
        time.sleep(1)
    return None, None


def boton_exportar_en(y, tol=6, timeout=10):
    _, info = _jab_buscar(nombre="Exportar", role="push button", timeout=timeout,
                           y_min=y - tol, y_max=y + tol)
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--consulta", required=True)
    ap.add_argument("--desde", required=True, help="DD/MM/AAAA")
    ap.add_argument("--hasta", required=True, help="DD/MM/AAAA")
    ap.add_argument("--dry-run", action="store_true",
                     help="Llega hasta el modal PERIODO pero no aprieta ACEPTAR")
    args = ap.parse_args()

    asegurar_sesion()
    cerrar_modales()

    log("Abriendo Gestor de Exportaciones...")
    frame, info = abrir_gestor_exportaciones()
    if not frame:
        log("ERROR: no encontre el Gestor de Exportaciones.")
        return 1
    log(f"Gestor de Exportaciones OK: {info.get('bounds')}")

    log(f"Buscando fila '{args.consulta}'...")
    y, _fila_info = fila_consulta(args.consulta)
    if y is None:
        log(f"ERROR: no encontre la consulta '{args.consulta}' en la grilla visible.")
        return 1
    log(f"Fila encontrada en y={y}")

    exportar_info = boton_exportar_en(y)
    if not exportar_info:
        log("ERROR: no encontre el boton Exportar de esa fila.")
        return 1
    log(f"Click en Exportar: {exportar_info.get('bounds')}")
    _jab_click_bounds(exportar_info)
    time.sleep(PAUSA_MEDIA)

    frame_periodo, info_periodo = _jab_wait_frame("PERIODO", timeout=10)
    if not frame_periodo:
        log("AVISO: no aparecio el modal PERIODO (quiza esta consulta no lo pide).")
        return 0
    log(f"Modal PERIODO abierto: {info_periodo.get('bounds')}")

    _, desde_info = _jab_buscar(nombre="Fecha Desde", role="text", timeout=8)
    _, hasta_info = _jab_buscar(nombre="Fecha Hasta", role="text", timeout=8)
    if not (desde_info and hasta_info):
        log("ERROR: no encontre los campos Fecha Desde / Fecha Hasta.")
        return 1

    log(f"Cargando Desde={args.desde} Hasta={args.hasta}")
    _jab_set_text_by_bounds(desde_info, args.desde)
    _jab_set_text_by_bounds(hasta_info, args.hasta)
    time.sleep(PAUSA_CORTA)

    if args.dry_run:
        log("DRY-RUN: no aprieto ACEPTAR. Cierro el modal con CANCELAR.")
        _, cancelar_info = _jab_buscar(nombre="CANCELAR Alt A", role="push button", timeout=6)
        if cancelar_info:
            _jab_click_bounds(cancelar_info)
        return 0

    log("Ventanas top-level ANTES de ACEPTAR:")
    for hwnd, titulo, clase in listar_ventanas_top():
        log(f"  hwnd={hwnd} clase={clase} titulo={titulo!r}")

    _, aceptar_info = _jab_buscar(nombre="ACEPTAR Alt A", role="push button", timeout=8)
    if not aceptar_info:
        log("ERROR: no encontre el boton ACEPTAR.")
        return 1
    log(f"Click en ACEPTAR: {aceptar_info.get('bounds')}")
    _jab_click_bounds(aceptar_info)
    time.sleep(PAUSA_LARGA)

    log("Ventanas top-level DESPUES de ACEPTAR:")
    for hwnd, titulo, clase in listar_ventanas_top():
        log(f"  hwnd={hwnd} clase={clase} titulo={titulo!r}")

    log("Buscando dialogo/aviso de SiAPe (JAB) post-ACEPTAR...")
    texto, botones = F.leer_dialogo_jab(max_segundos=10)
    if texto:
        log(f"Dialogo SiAPe: {texto[:300]}")
        for b in botones:
            log(f"  boton: {b.get('name')} bounds={b.get('bounds')}")
    else:
        log("No hay dialogo JAB visible.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
