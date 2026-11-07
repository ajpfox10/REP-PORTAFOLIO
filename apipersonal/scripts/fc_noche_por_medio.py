"""FC de relleno de los agentes que hacen NOCHE POR MEDIO (pedido del usuario 04/11/2026).

El horario de SIAPE de estos agentes dice "noche todos los dias" (p.ej. L a S 20-06), pero trabajan
dia por medio (L-X-V una semana, M-J-S la siguiente) y el jefe completa con FRANCO COMPENSATORIO las
noches que no van. Esos FC son relleno: NO se cargan en la Intranet (quedan DESCARTADA).

Como noche por medio = dia por medio estricto, las noches de relleno de un agente caen siempre del
mismo lado de la paridad del dia (date.toordinal() % 2). Regla:
  1. Solo FC de 1 dia que caen en un dia con turno de NOCHE en su horario (entra >= 18:00 y sale al
     dia siguiente; no cuentan 24 h ni las que salen 00:00).
  2. Patron por FC: de todos los FC nocturnos del agente (corrida del comparador + cola), al menos
     MIN_FC y >= UMBRAL caen del mismo lado -> ese es su lado de relleno.
  3. Seguridad por fichadas: las noches que fichO (entrada 17:00-23:59 en dia de turno noche, ultimos
     DIAS_FICHADAS dias) tienen que caer del lado CONTRARIO: al menos MIN_FICHADAS y >= UMBRAL.
  4. Solo con 2 y 3 confirmados se descartan los FC del lado de relleno. Un FC del otro lado (la noche
     que le toca venir) es un FC real y se carga normal. Sin patron o sin confirmacion: se carga todo.
"""
from collections import Counter, defaultdict
from datetime import date, timedelta

MIN_FC = 4
MIN_FICHADAS = 4
UMBRAL = 0.75
DIAS_FICHADAS = 90
DETALLE = "Descartada: FC de relleno noche por medio"

_DIAS = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")


def _es_noche(e, s):
    """Entra >= 18:00 y sale al dia siguiente (no 24 h, no salida 00:00)."""
    return bool(e and s) and s < e and e >= "18:00" and s != "00:00"


def _paridad(d):
    return d.toordinal() % 2


def _horarios(cur, dnis):
    """dni -> lista de (fecha_foto, [(e, s) x 7]) ordenada por fecha."""
    if not dnis:
        return {}
    cols = ", ".join(f"{d}_e, {d}_s" for d in _DIAS)
    cur.execute(f"SELECT dni, fecha, {cols} FROM horarios_historial WHERE dni IN "
                f"({','.join(['%s'] * len(dnis))}) ORDER BY fecha", tuple(dnis))
    out = defaultdict(list)
    for r in cur.fetchall():
        out[int(r["dni"])].append((r["fecha"], [(r[f"{d}_e"], r[f"{d}_s"]) for d in _DIAS]))
    return out


def _turno(fotos, d):
    """(e, s) del dia d segun la foto mas reciente <= d (si no hay anterior, la primera)."""
    if not fotos:
        return None, None
    elegida = fotos[0][1]
    for f, sem in fotos:
        if f <= d:
            elegida = sem
        else:
            break
    return elegida[d.weekday()]


def _noches_fichadas(cur, dnis):
    """dni -> set de fechas con entrada 17:00-23:59 (base biometrica adms_db, mismo servidor)."""
    out = defaultdict(set)
    if not dnis:
        return out
    try:
        cur.execute(f"""
            SELECT ui.badgenumber AS dni, DATE(ci.checktime) AS d
              FROM adms_db.checkinout ci JOIN adms_db.userinfo ui ON ui.userid = ci.userid
             WHERE ci.checktime >= %s AND TIME(ci.checktime) BETWEEN '17:00:00' AND '23:59:59'
               AND ui.badgenumber IN ({','.join(['%s'] * len(dnis))})""",
            (date.today() - timedelta(days=DIAS_FICHADAS), *[str(x) for x in dnis]))
        for r in cur.fetchall():
            try:
                out[int(r["dni"])].add(r["d"])
            except (TypeError, ValueError):
                pass
    except Exception as e:  # sin base biometrica no se confirma nada -> no se descarta nada
        print(f"  AVISO noche por medio: no pude leer fichadas ({e}); no se descarta ningun FC")
        return None
    return out


def lados_de_relleno(cur, corrida, dnis):
    """dni -> (lado_relleno, resumen) solo para agentes con patron confirmado por fichadas."""
    if not dnis:
        return {}
    ph = ",".join(["%s"] * len(dnis))
    fcs = defaultdict(set)
    dn = [str(x) for x in dnis]
    for q, args in (
        (f"""SELECT dni, desde_siap AS d FROM comparacion_novedades
              WHERE corrida_id = %s AND novedad_siap LIKE 'FRANCO COMPENSATORIO%%'
                AND desde_siap = hasta_siap AND dni IN ({ph})""", (corrida, *dn)),
        (f"""SELECT dni, desde AS d FROM novedades_carga_intranet
              WHERE novedad_siap LIKE 'FRANCO COMPENSATORIO%%' AND desde = hasta
                AND desde >= %s AND dni IN ({ph})""",
         (date.today() - timedelta(days=DIAS_FICHADAS), *dn)),
    ):
        cur.execute(q, args)
        for r in cur.fetchall():
            try:
                fcs[int(r["dni"])].add(r["d"])
            except (TypeError, ValueError):
                pass
    horarios = _horarios(cur, list(fcs))
    fichadas = _noches_fichadas(cur, list(fcs))
    if fichadas is None:
        return {}
    lados = {}
    for dni, dias in fcs.items():
        fotos = horarios.get(dni)
        noches = [d for d in dias if _es_noche(*_turno(fotos, d))]
        if len(noches) < MIN_FC:
            continue
        lado, n = Counter(_paridad(d) for d in noches).most_common(1)[0]
        if n / len(noches) < UMBRAL:
            continue
        fn = [d for d in fichadas.get(dni, ()) if _es_noche(*_turno(fotos, d))]
        if len(fn) < MIN_FICHADAS:
            continue
        opuestas = sum(1 for d in fn if _paridad(d) != lado)
        if opuestas / len(fn) < UMBRAL:
            continue
        lados[dni] = (lado, f"{n}/{len(noches)} FC del mismo lado, fichO {opuestas}/{len(fn)} noches del otro")
    return lados


def descartar_fc_relleno(cur, corrida, dependencia, tabla, estados_abiertos):
    """Marca DESCARTADA los FC de relleno abiertos de la corrida/dependencia. Devuelve cantidad."""
    cur.execute(f"""
        SELECT id, dni, desde FROM {tabla}
         WHERE corrida_id = %s AND dependencia = %s AND estado IN {estados_abiertos}
           AND novedad_siap LIKE 'FRANCO COMPENSATORIO%%' AND desde = hasta""",
        (corrida, dependencia))
    filas = cur.fetchall()
    if not filas:
        return 0
    lados = lados_de_relleno(cur, corrida, sorted({int(f["dni"]) for f in filas}))
    if not lados:
        return 0
    horarios = _horarios(cur, list(lados))
    n = 0
    for f in filas:
        dni, d = int(f["dni"]), f["desde"]
        if dni not in lados or not _es_noche(*_turno(horarios.get(dni), d)):
            continue
        lado, resumen = lados[dni]
        if _paridad(d) != lado:
            continue  # noche que le toca venir: FC real, se carga
        n += cur.execute(f"UPDATE {tabla} SET estado = 'DESCARTADA', detalle = %s WHERE id = %s",
                         (f"{DETALLE} ({resumen})"[:500], f["id"]))
    return n
