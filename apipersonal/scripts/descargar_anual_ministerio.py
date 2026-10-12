"""
Descarga el ANUAL de "Novedades registradas" de la Intranet del Ministerio (las 3 dependencias:
HOSPITAL, UPA 4, UPA 18) y lo vuelca a la tabla `ministerio_novedades_anual`.

Rango: del 01/01 del anio ANTERIOR al 31/12 del anio actual. El export del Ministerio filtra por
"fecha desde", asi que con solo el anio actual se pierden las licencias que arrancaron el anio
pasado (p. ej. una maternidad de diciembre).

Cada dependencia que baja bien REEMPLAZA sus filas de ese rango (DELETE + INSERT en una
transaccion): la tabla queda igual a lo que hoy dice el Ministerio, y lo anterior al rango se
conserva como historia. Si una dependencia falla o viene vacia, no se toca lo suyo.

Lo usa la DDJJ de Guarderia: fecha de reintegro = fin del RN1-RECIEN NACIDO (cuidado
extendido) + 1 dia. Robot `intranet_descarga_anual` (pagina Robots, cada 30 dias).

Uso:
  python descargar_anual_ministerio.py
  python descargar_anual_ministerio.py --dependencia "UPA 4"
  python descargar_anual_ministerio.py --desde 01/01/2025 --hasta 31/12/2026
"""
import argparse
import os
import re
import sys
import tempfile
import time
import unicodedata
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xlrd
from playwright.sync_api import sync_playwright

import cargar_ausentes_intranet as I          # login + perfil de Chrome de la Intranet
import descargar_novedades_ministerio as D    # descarga del form3 + conversion a .xls real
import mapeo_novedades as MN                  # .env, conexion y script_runs

SCRIPT_ID = "intranet_descarga_anual"
DEPENDENCIAS = ["HOSPITAL", "UPA 4", "UPA 18"]
LOTE = 500

DDL = """
CREATE TABLE IF NOT EXISTS ministerio_novedades_anual (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dependencia VARCHAR(20) NOT NULL,
  dni INT NULL,
  legajo VARCHAR(20) NULL,
  apellido_nombre VARCHAR(200) NULL,
  cargo VARCHAR(200) NULL,
  novedad VARCHAR(200) NULL,
  codigo VARCHAR(20) NULL,
  fecha_desde DATE NULL,
  fecha_hasta DATE NULL,
  tramite VARCHAR(100) NULL,
  expediente VARCHAR(100) NULL,
  run_uid VARCHAR(32) NULL,
  descargado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_mna_dni (dni),
  KEY ix_mna_codigo_dni (codigo, dni),
  KEY ix_mna_dep_desde (dependencia, fecha_desde)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
"""


def periodo(hoy=None):
    hoy = hoy or date.today()
    return date(hoy.year - 1, 1, 1), date(hoy.year, 12, 31)


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def _fecha(v):
    """El .xls convertido trae las fechas como serial entero de Excel."""
    if v in ("", None):
        return None
    if isinstance(v, (int, float)):
        return date(1899, 12, 30) + timedelta(days=int(round(v)))
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", str(v).strip())
    return date(int(m[3]), int(m[2]), int(m[1])) if m else None


def _txt(v, largo):
    if v in ("", None, "-"):            # el Ministerio manda "-" en cargo / tramite / expediente vacios
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()[:largo] or None


def leer_xls(ruta):
    sh = xlrd.open_workbook(str(ruta)).sheet_by_index(0)
    hdr = [_norm(c) for c in sh.row_values(0)]

    def col(*claves):
        for i, h in enumerate(hdr):
            if any(k in h for k in claves):
                return i
        raise RuntimeError(f"No encuentro la columna {claves} en {hdr}")

    c = {
        "legajo": col("legajo"), "dni": col("documento"), "nombre": col("apellido"),
        "cargo": col("cargo"), "novedad": col("novedad"), "desde": col("desde"),
        "hasta": col("hasta"), "tramite": col("tramite"), "expediente": col("expediente"),
    }
    filas = []
    for r in range(1, sh.nrows):
        v = sh.row_values(r)
        novedad = _txt(v[c["novedad"]], 200)
        dni = _txt(v[c["dni"]], 15)
        if not novedad and not dni:
            continue
        codigo = novedad.split("-", 1)[0].strip()[:20] if novedad and "-" in novedad else None
        filas.append((
            int(dni) if dni and dni.isdigit() else None,
            _txt(v[c["legajo"]], 20), _txt(v[c["nombre"]], 200), _txt(v[c["cargo"]], 200),
            novedad, codigo, _fecha(v[c["desde"]]), _fecha(v[c["hasta"]]),
            _txt(v[c["tramite"]], 100), _txt(v[c["expediente"]], 100),
        ))
    return filas


def reemplazar(dependencia, desde, hasta, filas):
    with MN.conn() as cn, cn.cursor() as cur:
        try:
            cur.execute(
                "DELETE FROM ministerio_novedades_anual "
                "WHERE dependencia = %s AND fecha_desde BETWEEN %s AND %s",
                (dependencia, desde, hasta))
            borradas = cur.rowcount
            sql = ("INSERT INTO ministerio_novedades_anual (dependencia, dni, legajo, apellido_nombre, cargo, "
                   "novedad, codigo, fecha_desde, fecha_hasta, tramite, expediente, run_uid) "
                   "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)")
            for i in range(0, len(filas), LOTE):
                cur.executemany(sql, [(dependencia, *f, MN.RUN_UID) for f in filas[i:i + LOTE]])
            cn.commit()
            return borradas
        except Exception:
            cn.rollback()
            raise


def volcar(dependencia, desde, hasta, ruta_xls):
    """Lo usa tambien descargar_novedades_ministerio.py: despues de pisar MINISTERIO/UPA4/UPA18.xls
    refresca en la tabla la franja que acaba de bajar (desde/hasta: date o DD/MM/AAAA)."""
    a_date = lambda v: v if isinstance(v, date) else date(*reversed([int(x) for x in v.split("/")]))
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(DDL)
        cn.commit()
    filas = leer_xls(ruta_xls)
    borradas = reemplazar(dependencia, a_date(desde), a_date(hasta), filas)
    return len(filas), borradas


def bajar_dependencia(p, password, dependencia, desde_txt, hasta_txt, tmp):
    browser, page = I.nueva_pagina(p)
    try:
        I.login(page, password, dependencia)   # cierra la sesion vieja antes de entrar
        crudo = D.descargar_crudo(page, desde_txt, hasta_txt, tmp, dependencia)
    finally:
        browser.close()
    xls = Path(tmp) / f"anual_{dependencia.replace(' ', '')}.xls"
    res = D.convertir(crudo, xls)
    if res["filas"] <= 0:
        raise RuntimeError("el listado vino vacio")
    return leer_xls(xls)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dependencia", help="solo una: HOSPITAL / UPA 4 / UPA 18 (si no, las 3)")
    ap.add_argument("--desde", help="DD/MM/AAAA (si no, 01/01 del anio anterior)")
    ap.add_argument("--hasta", help="DD/MM/AAAA (si no, 31/12 del anio actual)")
    ap.add_argument("--password", help="contrasena Intranet (si no, INTRANET_PASS del .env)")
    args = ap.parse_args()

    desde, hasta = periodo()
    if args.desde and args.hasta:
        desde = date(*reversed([int(x) for x in args.desde.split("/")]))
        hasta = date(*reversed([int(x) for x in args.hasta.split("/")]))
    deps = [args.dependencia.upper().strip()] if args.dependencia else DEPENDENCIAS
    if any(d not in DEPENDENCIAS for d in deps):
        print(f"ERROR: dependencia invalida '{args.dependencia}' (HOSPITAL / UPA 4 / UPA 18)")
        return 2
    desde_txt, hasta_txt = desde.strftime("%d/%m/%Y"), hasta.strftime("%d/%m/%Y")
    descripcion = f"Descarga anual Novedades registradas ({', '.join(deps)}) -> ministerio_novedades_anual"
    password = args.password or os.environ.get("INTRANET_PASS")  # sync-guard:ignore
    t0 = time.time()
    print(f"Anual Ministerio {desde_txt} a {hasta_txt}: {', '.join(deps)}")

    ok, errores, total = [], [], 0
    try:
        if not password:
            raise RuntimeError("Falta INTRANET_PASS en .env")
        with MN.conn() as cn, cn.cursor() as cur:
            cur.execute(DDL)
            cn.commit()
        with sync_playwright() as p:
            for dep in deps:
                try:
                    with tempfile.TemporaryDirectory() as tmp:
                        filas = bajar_dependencia(p, password, dep, desde_txt, hasta_txt, tmp)
                    borradas = reemplazar(dep, desde, hasta, filas)
                    rn1 = sum(1 for f in filas if f[5] == "RN1")
                    print(f"  {dep}: {len(filas)} novedades ({rn1} RN1), reemplazan {borradas}")
                    MN.registrar_item(SCRIPT_ID, novedad=dep, desde=desde_txt, hasta=hasta_txt, estado="ok",
                                      detalle=f"{len(filas)} novedades ({rn1} RN1), reemplazan {borradas}")
                    ok.append(f"{dep} {len(filas)}")
                    total += len(filas)
                except Exception as e:
                    print(f"  {dep}: ERROR {e}")
                    MN.registrar_item(SCRIPT_ID, novedad=dep, estado="error", detalle=str(e)[:900])
                    errores.append(f"{dep}: {e}")
    except Exception as e:
        errores.append(str(e))

    dur = int(time.time() - t0)
    if errores:
        motivo = "; ".join(errores)
        if ok:
            motivo = f"OK {', '.join(ok)} | FALLO {motivo}"
        print(f"ERROR: {motivo}")
        MN.registrar_run(SCRIPT_ID, descripcion, "error", motivo=motivo[:480], filas=total or None,
                         duracion_seg=dur)
        return 1
    motivo = f"{total} novedades ({', '.join(ok)}), vigencia {desde_txt} a {hasta_txt}"
    print(f"OK: {motivo}")
    MN.registrar_run(SCRIPT_ID, descripcion, "ok", motivo=motivo, filas=total,
                     archivo="ministerio_novedades_anual", duracion_seg=dur)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
