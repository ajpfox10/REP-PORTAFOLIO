"""
Tabla `tiempo_acumulado` (migracion 066): saldo de licencias de SIAPE por agente/año.

  importar_gestor(xlsx)      -> lo llama el robot de exportaciones despues de bajar la
                                consulta 13 "Tiempo Acumulado" del Gestor de Exportaciones.
  importar_discoverer(xls)   -> carga inicial desde el .xls de Discoverer (trae los ceros).

La consulta 13 NO trae las filas con 0 dias. Por eso la tabla guarda historia: lo que
estaba y deja de venir en una bajada (para los años que trae esa bajada) queda en 0
(origen='inferido_0'), solo si el agente sigue ACTIVO en `agentes`; si no, queda como
estaba con en_ultima_bajada=0.

Uso manual:
  python tiempo_acumulado_tabla.py --discoverer "D:\\G\\comparacion\\TIEMPO ACUMULADO.xls"
  python tiempo_acumulado_tabla.py --gestor "C:\\...\\reporte_2026....xlsx"
"""
import argparse
import os
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mapeo_novedades as MN  # conn() + .env

MIGRACION = Path(__file__).resolve().parents[1] / "migrations" / "066__tiempo_acumulado.sql"
MIN_FILAS_GESTOR = 200      # una bajada con menos filas se considera rota (no se importa)
MAX_PROP_A_CERO = 0.5       # si dejaria en 0 mas de la mitad de los saldos >0 de un año: freno
# APAGADO (08/10/2026): la consulta 13 NO equivale a Discoverer. Su año es AÑO_LICENCIA
# (Discoverer filtra "Año Calendario") y hay agentes que directamente no trae (ej. DNI
# 23331617: 28 dias de ANUAL en Discoverer, ausente en la consulta). Inferir "no vino =
# llego a 0" ponia en 0 gente con 14-28 dias y stress les hubiera cargado la
# complementaria. Hasta aclarar que filtra la consulta, lo que no viene solo se marca
# en_ultima_bajada=0 y conserva sus dias.
INFERIR_CEROS = False


def _norm(t):
    t = unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]", "", t.upper())


def _txt(v):
    return " ".join(str(v).split()) if v is not None else ""


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def asegurar_tabla(cn):
    """CREATE TABLE IF NOT EXISTS de la migracion 066 (idempotente)."""
    sql = "\n".join(l for l in MIGRACION.read_text(encoding="utf-8").splitlines()
                    if not l.lstrip().startswith("--"))
    with cn.cursor() as cur:
        cur.execute(sql.strip().rstrip(";"))
    cn.commit()


def _con_seq(filas):
    """SIAPE repite filas identicas: numera dentro de (dni, anio, licencia, regimen, planta),
    de mas dias a menos, para que la clave sea estable entre bajadas."""
    grupos = defaultdict(list)
    for f in filas:
        grupos[(f["dni"], f["anio"], f["licencia"], f["regimen"], f["planta"])].append(f)
    out = []
    for g in grupos.values():
        g.sort(key=lambda f: -f["dias"])
        for i, f in enumerate(g, 1):
            f["seq"] = i
            out.append(f)
    return out


def leer_gestor(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    filas = list(wb.active.iter_rows(values_only=True))
    if not filas:
        raise RuntimeError(f"{path} vacio")
    col = {_norm(h): i for i, h in enumerate(filas[0])}
    req = {"NUMERO", "APELLIDO", "NOMBRE", "ANOLICENCIA", "LICENCIAPERMISO", "CANTIDADDIAS"}
    falta = req - set(col)
    if falta:
        raise RuntimeError(f"La consulta no trae las columnas {sorted(falta)} (vino: {filas[0]})")
    g = lambda r, k: r[col[k]] if k in col else None
    out = []
    for r in filas[1:]:
        dni = int(re.sub(r"\D", "", str(g(r, "NUMERO") or "")) or 0)
        anio = int(_num(g(r, "ANOLICENCIA")))
        lic = _txt(g(r, "LICENCIAPERMISO"))
        if not dni or not anio or not lic:
            continue
        out.append({
            "dni": dni, "anio": anio, "licencia": lic,
            "regimen": _txt(g(r, "REGIMENESTATUTARIO")), "planta": _txt(g(r, "PLANTA")),
            "dias": _num(g(r, "CANTIDADDIAS")), "pasa": _txt(g(r, "PASAALOTROANO")) or None,
            "apellido_nombre": f"{_txt(g(r, 'APELLIDO'))}, {_txt(g(r, 'NOMBRE'))}",
            "tipo_doc": _txt(g(r, "TIPODOCUMENTO")) or None,
            "legajo": _txt(g(r, "LEGAJO")) or None,
            "estructura": _txt(g(r, "ESTRUCTURASERVICIO"))[:255] or None,
        })
    return _con_seq(out)


def leer_discoverer(path):
    import xlrd
    s = xlrd.open_workbook(path).sheet_by_index(0)
    m = re.search(r"Calendario\s*:\s*(\d{4})", " ".join(str(v) for v in s.row_values(0)))
    if not m:
        raise RuntimeError("No encuentro 'Año Calendario' en el titulo del .xls de Discoverer")
    anio = int(m.group(1))
    out = []
    for i in range(5, s.nrows):
        r = s.row_values(i)
        dni = int(re.sub(r"\D", "", str(r[2]).split(".")[0]) or 0) if r[2] not in ("", None) else 0
        lic = _txt(r[4])
        if not dni or not lic or lic == "Tipo de Licencia":
            continue
        leg = r[3]
        out.append({
            "dni": dni, "anio": anio, "licencia": lic,
            "regimen": _txt(r[16]), "planta": _txt(r[17]),
            "dias": _num(r[5]), "pasa": _txt(r[6]) or None,
            "apellido_nombre": _txt(r[0]), "tipo_doc": _txt(r[1]) or None,
            "legajo": (str(int(leg)) if isinstance(leg, float) else _txt(leg)) or None,
            "estructura": _txt(r[7])[:255] or None,
        })
    return _con_seq(out), anio


COLS = ("dni", "anio", "licencia", "regimen", "planta", "seq", "dias", "pasa",
        "apellido_nombre", "tipo_doc", "legajo", "estructura")


def importar_discoverer(path, cn=None):
    """Carga inicial: inserta lo que NO esta (no pisa datos de bajadas del Gestor)."""
    propio = cn is None
    cn = cn or MN.conn()
    asegurar_tabla(cn)
    filas, anio = leer_discoverer(path)
    visto = datetime.fromtimestamp(os.path.getmtime(path))
    with cn.cursor() as cur:
        cur.executemany(
            f"INSERT IGNORE INTO tiempo_acumulado ({', '.join(COLS)}, origen, en_ultima_bajada, visto_en) "
            f"VALUES ({', '.join(['%s'] * len(COLS))}, 'discoverer', 1, %s)",
            [tuple(f[c] for c in COLS) + (visto,) for f in filas])
        nuevas = cur.rowcount
    cn.commit()
    if propio:
        cn.close()
    return {"anio": anio, "filas": len(filas), "insertadas": nuevas}


def importar_gestor(path, cn=None):
    """Actualiza la tabla con una bajada de la consulta 13. Devuelve estadisticas."""
    propio = cn is None
    cn = cn or MN.conn()
    asegurar_tabla(cn)
    filas = leer_gestor(path)
    if len(filas) < MIN_FILAS_GESTOR:
        raise RuntimeError(f"La bajada trae {len(filas)} filas (< {MIN_FILAS_GESTOR}): parece rota, no la importo")
    anios = sorted({f["anio"] for f in filas})
    ahora = datetime.now()
    ph = ", ".join(["%s"] * len(anios))
    try:
        with cn.cursor() as cur:
            cur.execute(f"UPDATE tiempo_acumulado SET en_ultima_bajada=0 WHERE anio IN ({ph})", anios)
            cur.executemany(
                f"INSERT INTO tiempo_acumulado ({', '.join(COLS)}, origen, en_ultima_bajada, visto_en) "
                f"VALUES ({', '.join(['%s'] * len(COLS))}, 'siape', 1, %s) "
                "ON DUPLICATE KEY UPDATE dias=VALUES(dias), pasa=VALUES(pasa), "
                "apellido_nombre=VALUES(apellido_nombre), tipo_doc=VALUES(tipo_doc), legajo=VALUES(legajo), "
                "estructura=VALUES(estructura), origen='siape', en_ultima_bajada=1, visto_en=VALUES(visto_en)",
                [tuple(f[c] for c in COLS) + (ahora,) for f in filas])
            if not INFERIR_CEROS:
                cn.commit()
                return {"filas": len(filas), "anios": anios, "a_cero": 0}
            # freno: una bajada incompleta no puede poner a medio padron en 0
            cur.execute(
                f"""SELECT t.anio, SUM(t.en_ultima_bajada=0 AND a.dni IS NOT NULL) AS a_cero, COUNT(*) AS con_dias
                      FROM tiempo_acumulado t
                      LEFT JOIN (SELECT DISTINCT dni FROM agentes WHERE estado_empleo='ACTIVO') a ON a.dni = t.dni
                     WHERE t.anio IN ({ph}) AND t.dias <> 0
                     GROUP BY t.anio""", anios)
            for r in cur.fetchall():
                if r["con_dias"] >= 20 and r["a_cero"] / r["con_dias"] > MAX_PROP_A_CERO:
                    raise RuntimeError(
                        f"Año {r['anio']}: dejaria en 0 {r['a_cero']} de {r['con_dias']} saldos con dias; "
                        "la bajada parece incompleta, no la importo")
            # lo que estaba y no vino = llego a 0 (solo activos)
            cur.execute(
                f"""UPDATE tiempo_acumulado t
                      JOIN (SELECT DISTINCT dni FROM agentes WHERE estado_empleo='ACTIVO') a ON a.dni = t.dni
                       SET t.dias = 0, t.origen = 'inferido_0'
                     WHERE t.anio IN ({ph}) AND t.en_ultima_bajada = 0 AND t.dias <> 0""", anios)
            a_cero = cur.rowcount
        cn.commit()
    except Exception:
        cn.rollback()
        raise
    finally:
        if propio:
            cn.close()
    return {"filas": len(filas), "anios": anios, "a_cero": a_cero}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--discoverer", help="carga inicial desde el .xls de Discoverer")
    g.add_argument("--gestor", help="importa un reporte_*.xlsx de la consulta 13")
    a = ap.parse_args()
    print(importar_discoverer(a.discoverer) if a.discoverer else importar_gestor(a.gestor))
