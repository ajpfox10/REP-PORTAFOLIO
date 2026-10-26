"""
Historial de horarios de SIAPE -> tabla `horarios_historial` (migracion 090).

HORARIOS.xlsx (consulta 76 "Horario Administrativo a un dia") es solo el horario de HOY.
Para comparar fichadas viejas (pestaña Fichajes de Asistencia) hace falta el horario que
tenia cada agente en esa fecha: este robot baja la misma consulta con FECHA = dia 1 de cada
mes desde 01/01/2018 hasta hoy, guarda cada Excel en D:\\G\\comparacion\\HORARIOS_HISTORIAL
y lo carga en la tabla. Solo baja las fechas que faltan en `horarios_historial_cargas`:
si se corta, la proxima corrida sigue donde quedo; ya completo, solo agrega el mes nuevo
(y si no falta nada ni abre SiAPe).

  importar(xlsx, fecha, origen) -> tambien lo usa la exportacion diaria de HORARIOS.xlsx
                                   (origen 'diario', post "horarios_historial").

Uso:
  python horarios_historial.py                      # baja lo que falte desde 01/01/2018
  python horarios_historial.py --desde 01/01/2024 --max 3
  python horarios_historial.py --solo-importar      # carga los Excel ya bajados, sin SiAPe
  python horarios_historial.py --cortar-a 04:15     # no pide fechas nuevas pasada esa hora (sigue la proxima corrida)
"""
import argparse
import re
import sys
import time
from datetime import date, datetime, time as dtime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mapeo_novedades as MN  # conn() + .env

CONSULTA = "Horario Administrativo a un dia"
DESTINO_DIR = Path(r"D:\G\comparacion\HORARIOS_HISTORIAL")
DESDE_DEFAULT = "01/01/2018"
DIAS = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")
COLS_DIA = ("LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO")


def log(m):
    print(f"[{datetime.now():%H:%M:%S}] {m}", flush=True)


def _hora(v):
    if v is None:
        return None
    if isinstance(v, (datetime, dtime)):
        return f"{v.hour:02d}:{v.minute:02d}"
    m = re.search(r"(\d{1,2}):(\d{2})", str(v))
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def _txt(v, n):
    s = str(v or "").strip()
    return s[:n] if s and s != "-" else None


def leer(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    filas = list(wb.active.iter_rows(values_only=True))
    wb.close()
    if not filas:
        return []
    col = {str(h or "").strip().upper(): i for i, h in enumerate(filas[0])}
    req = {"NRO_DOCUMENTO", "LUNES_ENTRADA", "DOMINGO_SALIDA"}
    if req - set(col):
        raise RuntimeError(f"{path.name}: faltan columnas {sorted(req - set(col))} (vino: {filas[0]})")
    g = lambda r, k: r[col[k]] if k in col and col[k] < len(r) else None
    out = {}
    for r in filas[1:]:
        dni = int(re.sub(r"\D", "", str(g(r, "NRO_DOCUMENTO") or "")) or 0)
        if not dni:
            continue
        f = {"dni": dni, "apellido_nombre": _txt(g(r, "APELLIDO_NOMBRE"), 150)}
        for d, c in zip(DIAS, COLS_DIA):
            f[f"{d}_e"] = _hora(g(r, f"{c}_ENTRADA"))
            f[f"{d}_s"] = _hora(g(r, f"{c}_SALIDA"))
        f["regimen"] = _txt(g(r, "REGIMEN_ESTATURARIO"), 100)
        f["planta"] = _txt(g(r, "PLANTA"), 60)
        f["agrupamiento"] = _txt(g(r, "AGRUPAMIENTO"), 60)
        f["estructura"] = _txt(g(r, "ESTRUCTURA_SERVICIO"), 300)
        out[dni] = f   # si un DNI viene repetido queda la ultima fila
    return list(out.values())


def importar(path, fecha, origen):
    """Reemplaza la foto de `fecha` con el contenido del Excel. Devuelve la cantidad de filas."""
    path = Path(path)
    filas = leer(path)
    campos = ["dni", "apellido_nombre"] + [f"{d}_{x}" for d in DIAS for x in ("e", "s")] + \
             ["regimen", "planta", "agrupamiento", "estructura"]
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("DELETE FROM horarios_historial WHERE fecha = %s", (fecha,))
        if filas:
            cur.executemany(
                f"INSERT INTO horarios_historial (fecha, {', '.join(campos)}) "
                f"VALUES (%s, {', '.join(['%s'] * len(campos))})",
                [(fecha, *[f[c] for c in campos]) for f in filas],
            )
        cur.execute(
            "INSERT INTO horarios_historial_cargas (fecha, origen, archivo, filas) VALUES (%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE origen = VALUES(origen), archivo = VALUES(archivo), filas = VALUES(filas)",
            (fecha, origen, str(path), len(filas)),
        )
        cn.commit()
    return len(filas)


def registrar_sin_datos(fecha):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(
            "INSERT INTO horarios_historial_cargas (fecha, origen, archivo, filas) VALUES (%s,'historial',NULL,0) "
            "ON DUPLICATE KEY UPDATE filas = 0",
            (fecha,),
        )
        cn.commit()


def fechas_mensuales(desde, hasta):
    d = date(desde.year, desde.month, 1)
    if d < desde:
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    while d <= hasta:
        yield d
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def ya_cargadas():
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("SELECT fecha FROM horarios_historial_cargas")
        return {r["fecha"] for r in cur.fetchall()}


def archivo_de(f):
    return DESTINO_DIR / f"HORARIOS_{f:%Y-%m-%d}.xlsx"


def importar_bajados(pendientes):
    """Excel que quedaron en la carpeta y no llegaron a la tabla (corrida cortada)."""
    resto = []
    for f in pendientes:
        p = archivo_de(f)
        if p.exists():
            n = importar(p, f, "historial")
            log(f"{f:%d/%m/%Y}: ya estaba bajado, cargado ({n} agentes).")
        else:
            resto.append(f)
    return resto


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default=DESDE_DEFAULT, help="DD/MM/AAAA (default 01/01/2018)")
    ap.add_argument("--hasta", help="DD/MM/AAAA (default hoy)")
    ap.add_argument("--max", type=int, default=0, help="como mucho N fechas por corrida (0 = todas)")
    ap.add_argument("--solo-importar", action="store_true", help="solo carga los Excel ya bajados")
    ap.add_argument("--cortar-a", help="HH:MM: pasada esa hora no pide mas fechas (las que faltan, la proxima corrida)")
    ap.add_argument("--timeout-descarga", type=int, default=600)
    args = ap.parse_args()

    # programado a la 01:00 con --cortar-a 04:15: no se cruza con la cadena de las 04:40 (novedades, horarios, jefe)
    corte = None
    if args.cortar_a:
        corte = datetime.combine(date.today(), datetime.strptime(args.cortar_a, "%H:%M").time())
        if corte <= datetime.now():
            corte += timedelta(days=1)

    desde = datetime.strptime(args.desde, "%d/%m/%Y").date()
    hasta = datetime.strptime(args.hasta, "%d/%m/%Y").date() if args.hasta else date.today()
    DESTINO_DIR.mkdir(parents=True, exist_ok=True)

    hechas = ya_cargadas()
    pendientes = [f for f in fechas_mensuales(desde, hasta) if f not in hechas]
    log(f"Fechas {desde:%d/%m/%Y}..{hasta:%d/%m/%Y}: {len(pendientes)} pendiente(s).")
    pendientes = importar_bajados(pendientes)
    if args.solo_importar or not pendientes:
        log("Nada para bajar de SIAPE." if not pendientes else f"Quedan {len(pendientes)} sin bajar.")
        return 0
    if args.max:
        pendientes = pendientes[:args.max]

    import descargar_exportacion_siape as E   # recien aca: toma pantalla/DPI al importarse
    from escritorio_activo import asegurar_escritorio_activo

    # cada fecha va a su propio archivo; el registro en script_runs lo hace run_robot (una
    # fila por corrida, no una por mes)
    cfg = dict(E.CONSULTAS[CONSULTA], destino_dir=DESTINO_DIR, script_id="siape_horarios_historial",
               descripcion="Historial de horarios (consulta 76)", periodo="hoy")
    cfg.pop("post", None)
    original = E.CONSULTAS[CONSULTA]
    E.CONSULTAS[CONSULTA] = cfg
    E.registrar_resultado = lambda *a, **k: None

    asegurar_escritorio_activo(E.F.log)
    try:
        E.asegurar_sesion_con_reintentos()
    except Exception as e:
        log(f"ERROR: no pude asegurar la sesion de SIAPE: {e}")
        return 1

    ok, fallas, t0, cortado = 0, [], time.time(), False
    ya_bajados = []
    try:
        for i, f in enumerate(pendientes, 1):
            if corte and datetime.now() >= corte:
                log(f"Son mas de las {args.cortar_a}: corto aca, quedan {len(pendientes) - i + 1} para la proxima corrida.")
                cortado = True
                break
            destino = archivo_de(f)
            cfg["destino_nombre"] = destino.name
            args.fecha = f"{f:%d/%m/%Y}"
            log(f"--- {i}/{len(pendientes)}: {args.fecha} ---")
            if not E.descargar_con_reintentos(CONSULTA, args, ya_bajados):
                fallas.append(args.fecha)
                continue
            if destino.exists():
                n = importar(destino, f, "historial")
                log(f"{args.fecha}: {n} agentes cargados.")
            else:   # el portal dijo "sin datos"
                registrar_sin_datos(f)
                log(f"{args.fecha}: SIAPE no tiene horarios para esa fecha (0 filas).")
            ok += 1
    finally:
        E.CONSULTAS[CONSULTA] = original

    log(f"Fin: {ok}/{len(pendientes)} fecha(s) OK en {int(time.time() - t0)}s"
        + (f" - fallaron {len(fallas)}: {', '.join(fallas[:10])} (se reintentan en la proxima corrida)" if fallas else ""))
    return 1 if not ok and not cortado else 0


if __name__ == "__main__":
    raise SystemExit(main())
