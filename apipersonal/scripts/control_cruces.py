"""
Control de cruces SIAPE vs Ministerio vs fichadas, por mes (04/11/2026, pedido del usuario).
Se ve en el Comparador SIAPE, pestana "Control de cruces" (GET /comparacion-v2/cruces).

Fuentes:
  SIAPE       D:\\G\\comparacion\\SIAPE\\SIAPE.xlsx (Novedades Por Periodo: cubre desde el 1 del mes anterior)
  Ministerio  ministerio_novedades_anual (se actualiza con cada descarga del Ministerio x3)
  Fichadas    adms_db.checkinout (entrada del turno: checktype 0 entre -3 h y +4 h de la hora de entrada,
              o 1 hasta +15 min) + horario del dia (horarios_historial, foto <= fecha)
  Otras       control_ausentes.motivos_por_dia (jefe, Salud Laboral, rotaciones, comisiones, vacaciones)

Reglas de tardanza (las mismas que el robot de ausentes): mas de 8 min = tarde; desde la 3ra tarde del mes
cada tarde es ausente; mas de 30 min = ausente.

Categorias (columna `categoria`):
  C1  28 en el Ministerio sin ausente en SIAPE
  C2  Ausente en SIAPE sin nada en el Ministerio
  C2B Ausente que el robot cargo OK pero ya no esta en el Ministerio (borrado a mano)
  C3  Ausente en SIAPE pero ficho la entrada
  C4  28 en el Ministerio pero ficho la entrada
  C5  Novedad distinta en SIAPE y en el Ministerio (sin contar equivalencias: enfermedad = E/01/1R/04)
  C6  Licencia o franco en SIAPE pero ficho la entrada
  C7  No ficho la entrada y no tiene ninguna novedad en ningun lado
  C8  Ausente por tardanza (8/30 min, 3ra tarde) sin nada cargado  [revisar: puede ser horario de SIAPE desfasado]

Resultado en la tabla control_cruces (se reemplaza el mes entero en cada corrida).

Uso:  python control_cruces.py              (mes anterior y mes en curso)
      python control_cruces.py --mes 2026-10
"""
import argparse
import os
import sys
import time as _t
from collections import defaultdict
from datetime import date, datetime, time, timedelta

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN
import control_ausentes as CA

SCRIPT_ID = "control_cruces"
SIAPE_XLSX = os.path.join(os.environ.get("LICENCIAS_PDF_DIR") or r"D:\G\comparacion", "SIAPE", "SIAPE.xlsx")
PARCIAL = ("BOLETA", "LLEGO", "HORA", "LACTANCIA", "COMISION", "CITACION", "PRESENTE", "GREMIAL")
CATEGORIAS = {
    "C1": "28 en el Ministerio sin ausente en SIAPE",
    "C2": "Ausente en SIAPE sin nada en el Ministerio",
    "C2B": "Ausente cargado por el robot que ya no está en el Ministerio",
    "C3": "Ausente en SIAPE pero fichó la entrada",
    "C4": "28 en el Ministerio pero fichó la entrada",
    "C5": "Novedad distinta en SIAPE y en el Ministerio",
    "C6": "Licencia o franco en SIAPE pero fichó la entrada",
    "C7": "No fichó la entrada y no tiene ninguna novedad",
    "C8": "Ausente por tardanza sin nada cargado (revisar horario)",
}

SQL_TABLA = """
CREATE TABLE IF NOT EXISTS control_cruces (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  mes CHAR(7) NOT NULL,
  categoria VARCHAR(4) NOT NULL,
  dependencia VARCHAR(20) NOT NULL DEFAULT '',
  dni INT NOT NULL,
  nombre VARCHAR(160) NOT NULL DEFAULT '',
  ley VARCHAR(160) NOT NULL DEFAULT '',
  fecha DATE NOT NULL,
  turno VARCHAR(5) NOT NULL DEFAULT '',
  entrada VARCHAR(5) NOT NULL DEFAULT '',
  tarde_min INT NULL,
  siape VARCHAR(500) NOT NULL DEFAULT '',
  ministerio VARCHAR(500) NOT NULL DEFAULT '',
  detalle VARCHAR(500) NOT NULL DEFAULT '',
  calculado_en DATETIME NOT NULL,
  KEY ix_control_cruces_mes_cat (mes, categoria),
  KEY ix_control_cruces_dni (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def leer_siape(dias):
    wb = openpyxl.load_workbook(SIAPE_XLSX, read_only=True)
    rows = wb.active.iter_rows(values_only=True)
    I = None
    for r in rows:
        if r and "NOVEDAD" in r:
            I = {x: i for i, x in enumerate(r)}
            break
    S, nombre, fmin = defaultdict(lambda: defaultdict(list)), {}, None
    d0, d1 = dias[0], dias[-1]
    for r in rows:
        if not r[I["NRO_DOCUMENTO"]] or not r[I["FECHA_DESDE"]]:
            continue
        dni = int(r[I["NRO_DOCUMENTO"]])
        nombre[dni] = f"{r[I['APELLIDO']]}, {r[I['NOMBRE']]}"
        a = r[I["FECHA_DESDE"]].date()
        b = (r[I["FECHA_HASTA"]] or r[I["FECHA_DESDE"]]).date()
        fmin = a if fmin is None or a < fmin else fmin
        if b < d0 or a > d1:
            continue
        nov = str(r[I["NOVEDAD"]]).strip()
        d = max(a, d0)
        while d <= min(b, d1):
            S[dni][d].append(nov)
            d += timedelta(days=1)
    return S, nombre


def calcular(cur, anio, mes):
    d0 = date(anio, mes, 1)
    d1 = (date(anio + (mes == 12), mes % 12 + 1, 1) - timedelta(days=1))
    d1 = min(d1, date.today() - timedelta(days=1))
    dias = [d0 + timedelta(i) for i in range((d1 - d0).days + 1)]
    if not dias:
        return []
    S, nombre = leer_siape(dias)

    M, depM = defaultdict(lambda: defaultdict(list)), {}
    cur.execute("""SELECT dependencia, dni, apellido_nombre, novedad, fecha_desde, fecha_hasta FROM ministerio_novedades_anual
                    WHERE fecha_desde <= %s AND fecha_hasta >= %s""", (d1, d0))
    for r in cur.fetchall():
        dni = int(r["dni"])
        depM[dni] = r["dependencia"]
        nombre.setdefault(dni, r["apellido_nombre"] or "")
        d = max(r["fecha_desde"], d0)
        while d <= min(r["fecha_hasta"], d1):
            M[dni][d].append(str(r["novedad"]).strip())
            d += timedelta(days=1)

    cod_de = defaultdict(set)
    for (nov, _cie), lab in MN.cargar_mapa_carga().items():
        cod_de[nov].add(lab.split(" - ")[0].strip())
    cur.execute("SELECT fecha FROM feriados")
    fer = {r["fecha"] for r in cur.fetchall()}
    Dn = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")
    cur.execute("SELECT dni, fecha, " + ",".join(f"{x}_e" for x in Dn) + " FROM horarios_historial ORDER BY fecha")
    fotos = defaultdict(list)
    for r in cur.fetchall():
        fotos[int(r["dni"])].append((r["fecha"], [r[f"{x}_e"] for x in Dn]))
    cur.execute("""SELECT ui.badgenumber dni, ci.checktime t, ci.checktype ct
                     FROM adms_db.checkinout ci JOIN adms_db.userinfo ui ON ui.userid = ci.userid
                    WHERE ci.checktime >= %s AND ci.checktime < %s""", (d0 - timedelta(days=1), d1 + timedelta(days=2)))
    marcas = defaultdict(list)
    for r in cur.fetchall():
        try:
            marcas[int(r["dni"])].append((r["t"], str(r["ct"]).strip()))
        except (TypeError, ValueError):
            pass
    for k in marcas:
        marcas[k].sort()
    cur.execute("""SELECT a.dni, l.nombre ley FROM agentes a LEFT JOIN ley l ON l.id = a.ley_id
                    WHERE a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO'""")
    ley = {int(r["dni"]): r["ley"] or "" for r in cur.fetchall()}
    cur.execute("""SELECT dni, desde, dependencia, detalle FROM novedades_carga_intranet
                    WHERE novedad_siap = 'AUSENTE SIN AVISO' AND estado = 'OK' AND desde BETWEEN %s AND %s""", (d0, d1))
    cola_ok = {(int(r["dni"]), r["desde"]): r for r in cur.fetchall() if str(r["dni"]).isdigit()}

    def turno(dni, d):
        lst = fotos.get(dni)
        if not lst:
            return None
        sem = lst[0][1]
        for f, s in lst:
            if f <= d:
                sem = s
        return sem[d.weekday()]

    def entrada(dni, d, e):
        hh, mm = (int(x) for x in str(e).split(":")[:2])
        ini = datetime.combine(d, time(hh, mm))
        for t, ct in marcas.get(dni, ()):
            if ct == "0" and ini - timedelta(hours=3) <= t <= ini + timedelta(hours=4):
                return t, max(0, int((t - ini).total_seconds() // 60))
            if ct == "1" and ini - timedelta(hours=3) <= t <= ini + timedelta(minutes=15):
                return t, max(0, int((t - ini).total_seconds() // 60))
        return None, None

    codigo = lambda n: n.split("-")[0].strip().upper()
    out = []
    for dni in set(fotos) | set(S) | set(M):
        info, tard = {}, []
        for d in dias:
            e = turno(dni, d)
            t, late = entrada(dni, d, e) if e else (None, None)
            info[d] = (e, t, late)
            if late is not None and CA.TOLERANCIA_MIN < late <= CA.AUSENTE_DESDE_MIN:
                tard.append(d)
        con_reloj = len(marcas.get(dni, ())) >= 5
        for d in dias:
            e, t, late = info[d]
            sn = [n for n in S.get(dni, {}).get(d, []) if n.upper() != "PRESENTE"]
            s_aus = any(n.upper() == "AUSENTE SIN AVISO" for n in sn)
            mn = M.get(dni, {}).get(d, [])
            m28 = any(codigo(x) == "28" for x in mn)
            n_tarde = tard.index(d) + 1 if d in tard else 0
            aus_tard = late is not None and (late > CA.AUSENTE_DESDE_MIN or n_tarde >= CA.TARDES_POR_AUSENTE)
            vino = t is not None and not aus_tard
            base = dict(dependencia=depM.get(dni, ""), dni=dni, nombre=nombre.get(dni, ""), ley=ley.get(dni, ""), fecha=d,
                        turno=e or "", entrada=t.strftime("%H:%M") if t else "", tarde_min=late,
                        siape="; ".join(sn), ministerio="; ".join(mn), detalle="")

            def add(cat, detalle=""):
                out.append(dict(base, categoria=cat, detalle=detalle))

            if m28 and not s_aus:
                add("C1", "En SIAPE: " + ("; ".join(sn) if sn else "nada ese día"))
            if s_aus and not mn:
                c = cola_ok.get((dni, d))
                if c:
                    add("C2B", f"La cola del robot dice OK: {(c['detalle'] or '')[:150]}")
                else:
                    add("C2")
            if s_aus and vino:
                add("C3", f"Entró {t:%H:%M} (turno {e})" + (f", {late} min tarde, {n_tarde}ª tarde del mes" if n_tarde else ""))
            if m28 and vino:
                add("C4", f"Entró {t:%H:%M} (turno {e})" + (f", {late} min tarde, {n_tarde}ª tarde del mes" if n_tarde else ""))
            if mn:
                mcods = {codigo(x) for x in mn}
                distinto = s_aus and not m28
                for n in sn:
                    esp = cod_de.get(n.upper(), set())
                    if n.upper() == "AUSENTE SIN AVISO" or not esp or (esp & mcods) or any(p in n.upper() for p in PARCIAL):
                        continue
                    if ("ENFERMEDAD" in n.upper() or "ACCIDENTE" in n.upper()) and mcods & {"E", "01", "1R", "1RC", "1RO", "1RE", "1RD", "04"}:
                        continue
                    distinto = True
                if distinto:
                    add("C5")
            dia_completo = [n for n in sn if not any(p in n.upper() for p in PARCIAL) and n.upper() != "AUSENTE SIN AVISO"]
            if e and d not in fer and con_reloj and t is not None and late is not None and late <= CA.AUSENTE_DESDE_MIN and dia_completo:
                add("C6", f"Entró {t:%H:%M} (turno {e})")
            if e and d not in fer and con_reloj and t is None and not sn and not mn:
                add("C7")
            if aus_tard and not s_aus and not m28 and not sn:
                add("C8", f"Llegó {late} min tarde" + ("" if late > CA.AUSENTE_DESDE_MIN else f", {n_tarde}ª tarde del mes"))

    # C7: si otra fuente lo justifica (jefe, Salud Laboral, rotacion...) no es error
    c7 = [r for r in out if r["categoria"] == "C7"]
    dd = defaultdict(set)
    for r in c7:
        dd[r["dni"]].add(r["fecha"])
    mot, _ = CA.motivos_por_dia(cur, dd) if dd else ({}, [])
    fuera = set()
    for i, r in enumerate(out):
        if r["categoria"] == "C7":
            ms = [m for m in mot.get((r["dni"], r["fecha"]), []) if not m.startswith(("fichó", "SIAPE", "Ministerio"))]
            if ms:
                fuera.add(i)
    return [r for i, r in enumerate(out) if i not in fuera]


def guardar(cn, mes_txt, filas):
    ahora = datetime.now()
    with cn.cursor() as cur:
        cur.execute(SQL_TABLA)
        cur.execute("DELETE FROM control_cruces WHERE mes = %s", (mes_txt,))
        cur.executemany("""INSERT INTO control_cruces (mes, categoria, dependencia, dni, nombre, ley, fecha, turno, entrada,
                                                       tarde_min, siape, ministerio, detalle, calculado_en)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        [(mes_txt, r["categoria"], r["dependencia"] or "", r["dni"], (r["nombre"] or "")[:160], (r["ley"] or "")[:160],
                          r["fecha"], r["turno"][:5], r["entrada"], r["tarde_min"], r["siape"][:500], r["ministerio"][:500],
                          r["detalle"][:500], ahora) for r in filas])
    cn.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mes", action="append", help="AAAA-MM (se puede repetir); sin esto: mes anterior y mes en curso")
    args = ap.parse_args()
    hoy = date.today()
    meses = args.mes or [f"{(hoy.replace(day=1) - timedelta(days=1)):%Y-%m}", f"{hoy:%Y-%m}"]
    t0 = _t.time()
    resumen = []
    try:
        with MN.conn() as cn, cn.cursor() as cur:
            for m in meses:
                a, mm = (int(x) for x in m.split("-"))
                filas = calcular(cur, a, mm)
                guardar(cn, m, filas)
                cnt = defaultdict(int)
                for r in filas:
                    cnt[r["categoria"]] += 1
                resumen.append(f"{m}: " + ", ".join(f"{k} {cnt[k]}" for k in CATEGORIAS if cnt[k]))
                print(resumen[-1])
        MN.registrar_run(SCRIPT_ID, "Control de cruces SIAPE vs Ministerio vs fichadas", "ok",
                         motivo=" · ".join(resumen)[:480], duracion_seg=int(_t.time() - t0))
    except Exception as e:
        MN.registrar_run(SCRIPT_ID, "Control de cruces SIAPE vs Ministerio vs fichadas", "error",
                         motivo=str(e)[:480], duracion_seg=int(_t.time() - t0))
        raise


if __name__ == "__main__":
    main()
