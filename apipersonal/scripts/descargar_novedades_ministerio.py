"""
Descarga "Novedades registradas" de la Intranet del Ministerio (Parte de Novedades ->
Plantel y prestacion de serv. -> Listados -> Reportes) en Excel, lo convierte a .xls de
verdad (lo que baja es un "xls mentiroso") y lo guarda pisando
  D:\\G\\comparacion\\MINISTERIO\\MINISTERIO.xls
que es el archivo que lee el comparador SIAPE vs Ministerio. Registra el resultado (ok/error)
en script_runs para la pagina Robots.

Con --dependencia "UPA 4" / "UPA 18" entra a esa dependencia (cambiar dependencia de la
Intranet) y guarda MINISTERIO\\UPA4.xls / MINISTERIO\\UPA18.xls (cada una es un robot aparte).

Rango de vigencia por defecto: el mismo que "Novedades Por Periodo" de SIAPE (del 1 del mes
actual a fin de anio; oct-dic se estira a feb-abr del anio siguiente) para comparar la misma
ventana. --desde / --hasta lo pisan.

Uso:
  python descargar_novedades_ministerio.py
  python descargar_novedades_ministerio.py --dependencia "UPA 4"
  python descargar_novedades_ministerio.py --desde 01/09/2026 --hasta 31/12/2026
  python descargar_novedades_ministerio.py --destino C:\\tmp\\prueba.xls     (prueba, no pisa)
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

import cargar_ausentes_intranet as I   # login + perfil de Chrome de la Intranet
import mapeo_novedades as MN

URL_REPORT = "https://sistemas.ms.gba.gov.ar/partenovedades/web/app.php/plantel/report"
CARPETA = Path(r"D:\G\comparacion\MINISTERIO")
# dependencia -> (script_id en la pagina Robots, archivo que deja)
DEPENDENCIAS = {
    "HOSPITAL": ("intranet_descarga_novedades", "MINISTERIO.xls"),
    "UPA 4": ("intranet_descarga_novedades_upa4", "UPA4.xls"),
    "UPA 18": ("intranet_descarga_novedades_upa18", "UPA18.xls"),
}
SCRIPTS_DIR = Path(__file__).resolve().parent


def calcular_periodo(hoy=None):
    """Igual que descargar_exportacion_siape.calcular_periodo (Novedades Por Periodo)."""
    hoy = hoy or date.today()
    # desde el 1 del MES ANTERIOR (04/10/2026), igual que la exportacion de SIAPE
    desde = date(hoy.year - 1, 12, 1) if hoy.month == 1 else date(hoy.year, hoy.month - 1, 1)
    if hoy.month <= 9:
        hasta = date(hoy.year, 12, 31)
    else:
        mes_hasta = {10: 2, 11: 3, 12: 4}[hoy.month]
        anio = hoy.year + 1
        bisiesto = anio % 4 == 0 and (anio % 100 != 0 or anio % 400 == 0)
        hasta = date(anio, mes_hasta, {2: 29 if bisiesto else 28, 3: 31, 4: 30}[mes_hasta])
    return desde.strftime("%d/%m/%Y"), hasta.strftime("%d/%m/%Y")


def _poner_fecha(page, sel, valor):
    """Los campos de vigencia tienen datepicker: .fill() a veces lo deja vacio. Se escribe el
    valor por JS (con eventos) y se verifica."""
    page.evaluate(
        """([sel, v]) => { const e = document.querySelector(sel); e.value = v;
             e.dispatchEvent(new Event('input', {bubbles: true}));
             e.dispatchEvent(new Event('change', {bubbles: true})); }""",
        [sel, valor],
    )
    page.keyboard.press("Escape")          # cierra el datepicker si se abrio
    if page.input_value(sel) != valor:
        page.fill(sel, valor)
    if page.input_value(sel) != valor:
        raise RuntimeError(f"No pude completar {sel} con {valor}")


def descargar_crudo(page, desde, hasta, carpeta, dependencia="HOSPITAL"):
    page.goto(URL_REPORT, wait_until="networkidle", timeout=30000)
    codigo = I.MAPA_DEP_CODIGO[dependencia]
    if f"({codigo})" not in page.content():            # el listado sale de la dependencia activa
        raise RuntimeError(f"La Intranet no quedo en {dependencia} ({codigo}): no bajo el listado de otra")
    page.wait_for_selector("#form3_fechaDesde", timeout=20000)
    _poner_fecha(page, "#form3_fechaDesde", desde)
    _poner_fecha(page, "#form3_fechaHasta", hasta)
    page.check("#form3_tipoArchivo_1")                      # Excel
    if not page.is_checked("#form3_tipoArchivo_1"):
        raise RuntimeError("No quedo marcado Excel como tipo de archivo")
    # El boton "Descargar listado" dispara una descarga y el Chrome del perfil persistente se
    # cierra solo en ese instante (Download.save_as -> "browser has been closed"). Por eso se
    # manda el MISMO formulario (campos + token) por la sesion del navegador y la respuesta
    # es el archivo.
    form = "form[action$='/plantel/report/novedad']"
    campos = page.evaluate(
        "(sel) => Object.fromEntries(new FormData(document.querySelector(sel)).entries())", form)
    if campos.get("form3[tipoArchivo]") != "excel" or campos.get("form3[fechaDesde]") != desde:
        raise RuntimeError(f"El formulario no quedo como corresponde: {campos}")
    url = page.evaluate("(sel) => document.querySelector(sel).action", form)
    r = page.context.request.post(url, form=campos, timeout=300000)
    if not r.ok:
        raise RuntimeError(f"La Intranet respondio HTTP {r.status} al pedir el listado")
    cuerpo = r.body()
    if b"<form" in cuerpo[:20000].lower() and b"form3_fechadesde" in cuerpo.lower():
        raise RuntimeError("La Intranet devolvio la pagina del formulario en vez del archivo (sesion o datos invalidos)")
    crudo = Path(carpeta) / "NovedadesRegistradas.xls"
    crudo.write_bytes(cuerpo)
    return crudo


def convertir(crudo, salida):
    r = subprocess.run(["node", str(SCRIPTS_DIR / "convertir_xls_ministerio.mjs"), str(crudo), str(salida)],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=SCRIPTS_DIR)
    linea = next((l for l in reversed((r.stdout or "").splitlines()) if l.startswith("{")), None)
    if not linea:
        raise RuntimeError(f"La conversion no respondio: {(r.stderr or r.stdout)[-300:]}")
    res = json.loads(linea)
    if not res.get("ok"):
        raise RuntimeError(f"Conversion: {res.get('error')}")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dependencia", default="HOSPITAL", help="HOSPITAL / UPA 4 / UPA 18")
    ap.add_argument("--desde", help="DD/MM/AAAA (si no, 1 del mes anterior)")
    ap.add_argument("--hasta", help="DD/MM/AAAA (si no, fin de anio)")
    ap.add_argument("--destino", help="otro archivo de salida (para probar sin pisar MINISTERIO.xls)")
    ap.add_argument("--password", help="contrasena Intranet (si no, INTRANET_PASS del .env)")
    args = ap.parse_args()

    desde, hasta = calcular_periodo()
    if args.desde and args.hasta:
        desde, hasta = args.desde, args.hasta
    dependencia = args.dependencia.upper().strip()
    if dependencia not in DEPENDENCIAS:
        print(f"ERROR: dependencia invalida '{args.dependencia}' (HOSPITAL / UPA 4 / UPA 18)")
        return 2
    script_id, nombre = DEPENDENCIAS[dependencia]
    descripcion = f"Descarga Novedades registradas {dependencia} (Intranet MS) -> {nombre}"
    destino = Path(args.destino) if args.destino else CARPETA / nombre
    password = args.password or os.environ.get("INTRANET_PASS")
    t0 = time.time()
    print(f"Novedades registradas {dependencia} {desde} a {hasta} -> {destino}")

    try:
        if not password:
            raise RuntimeError("Falta INTRANET_PASS en .env")
        with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
            browser, page = I.nueva_pagina(p)
            try:
                I.login(page, password, dependencia)
                crudo = descargar_crudo(page, desde, hasta, tmp, dependencia)
            finally:
                browser.close()
            print(f"Descargado: {crudo.name} ({crudo.stat().st_size} bytes)")
            destino.parent.mkdir(parents=True, exist_ok=True)
            tmp_xls = Path(tmp) / nombre
            res = convertir(crudo, tmp_xls)
            if res["filas"] <= 0:
                raise RuntimeError(f"El listado vino vacio: no piso {nombre}")
            shutil.copyfile(tmp_xls, destino)                  # recien ahora se pisa
        dur = int(time.time() - t0)
        motivo = f"{res['filas']} novedades, vigencia {desde} a {hasta}"
        print(f"OK: {motivo} -> {destino}")
        MN.registrar_run(script_id, descripcion, "ok", motivo=motivo, filas=res["filas"],
                         archivo=str(destino), duracion_seg=dur)
        return 0
    except Exception as e:
        print(f"ERROR: {e}")
        MN.registrar_run(script_id, descripcion, "error", motivo=str(e)[:480],
                         duracion_seg=int(time.time() - t0))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
