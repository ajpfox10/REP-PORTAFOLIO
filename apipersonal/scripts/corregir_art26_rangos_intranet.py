"""
Corrige en la Intranet MS los 261 - POR CAUSAS PARTICULARES que el robot Art. 26 2.0 cargo con
RANGO (fecha + dias - 1). El 26 es SIEMPRE de UN dia (05/11/2026, usuario: "borralos y carga
como corresponde").

Por cada fila OK de art26_carga_intranet con hasta > desde:
  1. busca en el historial del agente el 261 con ese mismo desde-hasta (sin eliminar) y lo borra;
  2. carga el 261 de UN dia (la fecha del Art. 26);
  3. deja la fila con desde = hasta = fecha y el resultado.
Si no encuentra el 261 con rango no borra nada y avisa. Lo borrado queda en logs/261_rangos_borrados.csv.

Sin --confirmar solo lista lo que haria (no abre la Intranet).
"""
import argparse
import csv
import os
from datetime import datetime

import mapeo_novedades as MN
import cargar_art26_intranet as V
import cargar_novedades_intranet_v2 as IV2
from cargar_novedades_intranet_v2 import es_error_cierre
from borrar_fc_nocturnos_intranet import leer_historial_con_ids
from cargar_art26_intranet_v2 import LABEL_ART26, TABLA

RESPALDO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", "261_rangos_borrados.csv")


def _ddmm(d):
    return d.strftime("%d/%m/%Y")


def filas_a_corregir(dni=None):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(f"""SELECT id, art26_id, dni, nombre, desde, hasta, dependencia FROM {TABLA}
                         WHERE ((estado = 'OK' AND hasta > desde) OR detalle LIKE 'No encontre el 261%%')
                               {'AND dni = %s' if dni else ''}
                         ORDER BY dependencia, dni, desde""", ((dni,) if dni else ()))
        return cur.fetchall()


def es_261(novedad):
    n = IV2._sin_acentos(novedad or "").upper()
    return n.startswith("261") or "CAUSAS PARTICULARES" in n


def respaldar(f, h):
    os.makedirs(os.path.dirname(RESPALDO), exist_ok=True)
    nuevo = not os.path.exists(RESPALDO)
    with open(RESPALDO, "a", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh, delimiter=";")
        if nuevo:
            w.writerow(["cuando", "dni", "nombre", "novedad", "desde", "hasta", "id_intranet", "art26_id"])
        w.writerow([f"{datetime.now():%d/%m/%Y %H:%M}", f["dni"], f["nombre"], h["novedad"], h["desde"],
                    h["hasta"], h["delete_href"].split("/")[-2], f["art26_id"]])


def anotar(f, estado, detalle):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(f"""UPDATE {TABLA} SET hasta = desde, estado = %s, label_intranet = %s, detalle = %s,
                               intentos = intentos + 1, cargado_en = IF(%s, NOW(), cargado_en)
                         WHERE id = %s""",
                    (estado[:20], LABEL_ART26, detalle[:500], estado == "OK", f["id"]))
        cn.commit()


def corregir(page, password, f):
    dep, dni = f["dependencia"] or "HOSPITAL", int(f["dni"])
    d, h = _ddmm(f["desde"]), _ddmm(f["hasta"])
    ok, msg = V.ir_a_novedades(page, dni, password, dep, nombre=f["nombre"])
    if not ok:
        return "ERROR_NAV", f"No pude abrir el agente: {msg}"
    lista_url = page.url
    vivos = [x for x in leer_historial_con_ids(page)
             if not IV2._sin_acentos(x.get("eliminado") or "NO").upper().startswith("S")]
    rango = [x for x in vivos if es_261(x["novedad"]) and x["desde"] == d and x["hasta"] == h and x.get("delete_href")]
    if not rango:
        # Muchos se habian cargado como FC (antes del 04/11) y ese FC ya esta eliminado: no hay
        # nada que borrar, solo falta cargar el 261 de UN dia.
        if IV2.ya_cargada_igual(page, LABEL_ART26, d, d):
            return "OK", f"El 261 de un dia ya estaba ({d}); no habia rango para borrar"
        exito, msg = IV2.cargar_novedad(page, LABEL_ART26, d, d)
        if exito:
            return "OK", f"Corregido: no habia 261 activo ({d}-{h}); se cargo 261 solo el {d}"
        return ("PERIODO_CERRADO" if es_error_cierre(msg) else "ERROR"), f"Carga del 261 de {d} dio: {msg}"
    for x in rango:
        page.goto(f"{IV2.BASE_URL}{x['delete_href']}", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.goto(lista_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_load_state("networkidle", timeout=15000)
        sigue = [y for y in leer_historial_con_ids(page) if y["delete_href"] == x["delete_href"]
                 and not IV2._sin_acentos(y.get("eliminado") or "NO").upper().startswith("S")]
        if sigue:
            return "ERROR", f"No se pudo borrar el 261 {d}-{h} en la Intranet"
        respaldar(f, x)
        print(f"  Borrado 261 {d} - {h}")
    if not V.ir_a_novedades(page, dni, password, dep, nombre=f["nombre"])[0]:
        return "ERROR_NAV", f"Borre el 261 {d}-{h} pero no pude volver a abrir el agente para cargar {d}"
    if IV2.ya_cargada_igual(page, LABEL_ART26, d, d):
        return "OK", f"Borrado el rango {d}-{h}; el 261 de {d} ya estaba"
    exito, msg = IV2.cargar_novedad(page, LABEL_ART26, d, d)
    if exito:
        return "OK", f"Corregido: se borro el rango {d}-{h} y se cargo 261 solo el {d}"
    estado = "PERIODO_CERRADO" if es_error_cierre(msg) else "ERROR"
    return estado, f"Se borro el rango {d}-{h} pero la carga de {d} dio: {msg}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirmar", action="store_true", help="borra y carga de verdad en la Intranet")
    ap.add_argument("--dni", help="solo este agente (para probar)")
    args = ap.parse_args()
    filas = filas_a_corregir(args.dni)
    print(f"261 con rango a corregir: {len(filas)}")
    for f in filas:
        print(f"  {f['dependencia']:8} {f['dni']}  {f['nombre'][:35]:35} {_ddmm(f['desde'])} -> {_ddmm(f['hasta'])}"
              f"  => borrar y cargar solo {_ddmm(f['desde'])}")
    if not args.confirmar or not filas:
        return
    password = os.environ.get("INTRANET_PASS")
    if not password:
        raise RuntimeError("Falta INTRANET_PASS en el .env")
    from playwright.sync_api import sync_playwright
    res = {}
    with sync_playwright() as p:
        browser, page = V.nueva_pagina(p)
        dep_actual = None
        for f in filas:
            dep = f["dependencia"] or "HOSPITAL"
            print(f"\n{f['nombre']} (DNI {f['dni']}) {dep}")
            try:
                if dep != dep_actual:
                    V.login(page, password, dep)
                    dep_actual = dep
                estado, detalle = corregir(page, password, f)
            except Exception as e:
                estado, detalle = "EXCEPCION", f"{e}"[:300]
                dep_actual = None
            print(f"  {estado}: {detalle}")
            anotar(f, estado, detalle)
            res[estado] = res.get(estado, 0) + 1
        try:
            browser.close()
        except Exception:
            pass
    print(f"\nResultado: {res}")


if __name__ == "__main__":
    main()
