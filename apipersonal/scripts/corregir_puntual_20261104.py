"""
Correcciones puntuales en la Intranet MS pedidas por el usuario el 04/11/2026:

  ROMANO, CECILIA CAROLINA (Hospital): el 02/10 SIAPE dice FC y el Ministerio tiene 28
      -> borrar el 28 del 02/10 y cargar 34 - FRANCO COMPENSATORIO 02/10.
  HERRERA, SERGIO JAVIER (UPA 4): el Ministerio tiene 28 del 30/10 al 31/10; SIAPE dice FC el 30/10
      y AUSENTE el 31/10 -> borrar el 28 30-31/10, cargar FC 30/10 y 28 solo el 31/10.
  PETRULLO, MARGARITA (Hospital): nacimiento 30/10/2026 a 27/01/2027 (06 - POR MATERNIDAD) cruza de
      anio -> se carga en dos: 30/10/2026-31/12/2026 y 01/01/2027-27/01/2027.

Cada paso deja el resultado en novedades_carga_intranet (detalle con la fecha de hoy).
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN
import cargar_novedades_intranet_v2 as C
import cargar_art26_intranet as V            # carga FC (34)
import intranet_liberar_28 as L28
from playwright.sync_api import sync_playwright

PW = os.environ.get("INTRANET_PASS")
HOY = f"{datetime.now():%d/%m/%Y %H:%M}"


def anotar(fila_id, estado, label, detalle):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(f"""UPDATE {C.TABLA_CARGA} SET estado=%s, label_intranet=%s, detalle=%s,
                               cargado_en=IF(%s, NOW(), cargado_en), intentos=intentos+1 WHERE id=%s""",
                    (estado, label, f"{detalle} ({HOY}, corrección puntual)"[:500], estado == "OK", fila_id))
        cn.commit()
    print(f"    cola #{fila_id} -> {estado}: {detalle[:120]}")


def abrir(page, dni, dep):
    ok, msg = C.ir_a_novedades(page, dni, PW, dep)
    if not ok:
        raise RuntimeError(f"no pude abrir {dni}: {msg}")


def cargar(page, dni, dep, label, desde, hasta, fila_id):
    abrir(page, dni, dep)
    if label is None:
        exito, msg, real = V.cargar_novedad_fc(page, desde, hasta)
        label = real or "34 - FRANCO COMPENSATORIO"
    else:
        exito, msg = C.cargar_novedad(page, label, desde, hasta)
    print(f"  {label} {desde}-{hasta}: {'OK' if exito else 'ERROR ' + str(msg)}")
    if fila_id:
        anotar(fila_id, "OK" if exito else "ERROR", label, f"{desde} a {hasta}: {msg}")
    return exito


def main():
    with sync_playwright() as p:
        browser, page = C.nueva_pagina(p)
        try:
            # ── Hospital ──
            C.login(page, PW, "HOSPITAL")
            print("ROMANO 31905218: borrar 28 02/10 y cargar FC")
            abrir(page, 31905218, "HOSPITAL")
            b, otros = L28.liberar_28(page, 31905218, "02/10/2026", "02/10/2026", "FC de SIAPE (corrección)")
            print(f"  28 borrados: {b} {otros or ''}")
            if b and not otros:
                cargar(page, 31905218, "HOSPITAL", None, "02/10/2026", "02/10/2026", 4237)

            print("PETRULLO: nacimiento partido en dos")
            cur_label = "06 - POR MATERNIDAD"
            ok1 = cargar(page, PETRULLO_DNI, "HOSPITAL", cur_label, "30/10/2026", "31/12/2026", None)
            ok2 = cargar(page, PETRULLO_DNI, "HOSPITAL", cur_label, "01/01/2027", "27/01/2027", None)
            anotar(9611, "OK" if ok1 and ok2 else "ERROR", cur_label,
                   f"Partido en dos por cruce de año: 30/10/2026-31/12/2026 {'OK' if ok1 else 'ERROR'} · "
                   f"01/01/2027-27/01/2027 {'OK' if ok2 else 'ERROR'}")

            # ── UPA 4 ──
            C.cambiar_dependencia(page, "UPA 4")
            print("HERRERA 35633835: borrar 28 30-31/10, cargar FC 30/10 y 28 31/10")
            abrir(page, 35633835, "UPA 4")
            b, otros = L28.liberar_28(page, 35633835, "30/10/2026", "30/10/2026", "FC de SIAPE (corrección)")
            print(f"  28 borrados: {b} {otros or ''}")
            if b and not otros:
                cargar(page, 35633835, "UPA 4", None, "30/10/2026", "30/10/2026", 11781)
                cargar(page, 35633835, "UPA 4", "28 - INASISTENCIA", "31/10/2026", "31/10/2026", 11875)
        finally:
            try:
                C.cerrar_sesion(page)
            except Exception:
                pass
            browser.close()


def _dni_petrullo():
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(f"SELECT dni FROM {C.TABLA_CARGA} WHERE id = 9611")
        return int(cur.fetchone()["dni"])


PETRULLO_DNI = _dni_petrullo()

if __name__ == "__main__":
    main()
