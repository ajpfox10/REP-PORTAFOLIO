"""Control cruzado de los AUSENTE SIN AVISO antes de cargarlos en la Intranet (04/11/2026, pedido del
usuario): un ausente NO se carga como 28 - INASISTENCIA si ese dia el agente

  - FICHO LA ENTRADA de su turno de ese dia (adms_db.checkinout, checktype 0; ver entrada_del_dia),
    salvo que haya llegado mas de 30 min tarde o sea su 3ra (o posterior) llegada tarde (+8 min) del mes
  - tiene OTRA novedad en SIAPE (tabla historial, que vuelca el SIAPE.xlsx)
  - tiene una novedad en el MINISTERIO (ministerio_novedades_anual, salvo la 28 misma)
  - SALUD LABORAL: reconocimiento medico (no rechazado) o turno en Salud Laboral
  - lo cargo el JEFE: Art. 26, franco compensatorio, examen, pre-examen, Pap/Colpo, practicas,
    novedades de becados (novedad_jefe)
  - estaba de ROTACION (residentes: rotacion_carga_siape)
  - estaba en COMISION (agentes_comisiones) o de VACACIONES ADELANTADAS

Esos quedan en estado NO_ES_AUSENTE con el motivo en el detalle. Se revisa en cada corrida: si el
motivo desaparece (p.ej. el jefe borro el Art. 26) vuelve a PENDIENTE.
Si una fuente no se puede leer (p.ej. la base del reloj) se avisa y se sigue con las demas.
"""
from collections import defaultdict
from datetime import date, datetime, time, timedelta

ESTADO = "NO_ES_AUSENTE"
# Llegadas tarde (pedido del usuario 04/11/2026): mas de 8 min = tarde; desde la 3ra tarde del mes
# CADA tarde es ausente (3ra, 4ta, 5ta...); mas de 30 min tarde = ausente. En esos casos la entrada NO justifica.
TOLERANCIA_MIN = 8
AUSENTE_DESDE_MIN = 30
TARDES_POR_AUSENTE = 3
_DIAS = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")
_PH = lambda xs: ",".join(["%s"] * len(xs))


def _rangos(cur, sql, args, etiqueta, motivos, dnis_dias):
    """Ejecuta un SELECT dni, desde, hasta[, extra] y anota `etiqueta` en los (dni, dia) que cubre."""
    cur.execute(sql, args)
    for r in cur.fetchall():
        try:
            dni = int(r["dni"])
        except (TypeError, ValueError):
            continue
        d, h = r["desde"], r["hasta"] or r["desde"]
        if not d:
            continue
        for dia in dnis_dias.get(dni, ()):
            if d <= dia <= h:
                txt = etiqueta + (f" ({r['extra']})" if r.get("extra") else "")
                if txt not in motivos[(dni, dia)]:
                    motivos[(dni, dia)].append(txt)


def _fichadas(cur, dnis_dias, motivos, avisos):
    """Entrada fichada en el reloj para el turno del dia (ver entrada_del_dia)."""
    dnis = list(dnis_dias)
    todos = [d for ds in dnis_dias.values() for d in ds]
    cols = ", ".join(f"{d}_e, {d}_s" for d in _DIAS)
    cur.execute(f"SELECT dni, fecha, {cols} FROM horarios_historial WHERE dni IN ({_PH(dnis)}) ORDER BY fecha",
                tuple(dnis))
    fotos = defaultdict(list)
    for r in cur.fetchall():
        fotos[int(r["dni"])].append((r["fecha"], [(r[f"{d}_e"], r[f"{d}_s"]) for d in _DIAS]))

    def turno(dni, dia):
        """(entrada, salida) del dia segun la foto de horario mas reciente <= dia."""
        lista = fotos.get(dni)
        if not lista:
            return None, None
        sem = lista[0][1]
        for f, s in lista:
            if f <= dia:
                sem = s
        return sem[dia.weekday()]

    def entrada_del_dia(dni, dia, lista):
        """Marca de ENTRADA del turno de ese dia (pedido del usuario 04/11/2026: que fiche no alcanza,
        tiene que estar fichada la entrada). lista = [(hora, checktype)] con 0 = entrada, 1 = salida.
        Con turno ese dia: entrada (0) entre 3 h antes y 4 h despues de la hora de entrada; tambien una
        salida (1) hasta 15 min despues del inicio (hay quien entra por el reloj de salida).
        Sin turno ese dia en el horario: cualquier entrada (0) del dia calendario.
        Devuelve (hora, como, minutos_tarde) — minutos_tarde None si no hay turno para medirlo."""
        e, _s = turno(dni, dia)
        if e:
            hh, mm = (int(x) for x in str(e).split(":")[:2])
            inicio = datetime.combine(dia, time(hh, mm))
            for t, ct in lista:
                ok0 = ct == "0" and inicio - timedelta(hours=3) <= t <= inicio + timedelta(hours=4)
                ok1 = ct == "1" and inicio - timedelta(hours=3) <= t <= inicio + timedelta(minutes=15)
                if ok0 or ok1:
                    tarde = max(0, int((t - inicio).total_seconds() // 60))
                    return t, f"turno {e}" + ("" if ok0 else ", por reloj de salida"), tarde
            return None, None, None
        ini = datetime.combine(dia, time(0))
        for t, ct in lista:
            if ct == "0" and ini <= t < ini + timedelta(days=1):
                return t, "sin turno ese dia en el horario", None
        return None, None, None

    def es_tarde(minutos):
        return minutos is not None and TOLERANCIA_MIN < minutos <= AUSENTE_DESDE_MIN

    # marcas de los MESES completos de los ausentes: hacen falta para contar las llegadas tarde del mes
    meses = sorted({(d.year, d.month) for d in todos})
    desde = date(meses[0][0], meses[0][1], 1) - timedelta(days=1)
    ult_a, ult_m = meses[-1]
    hasta = (date(ult_a + (ult_m == 12), ult_m % 12 + 1, 1)) + timedelta(days=2)
    try:
        cur.execute(f"""
            SELECT ui.badgenumber AS dni, ci.checktime AS t, ci.checktype AS ct
              FROM adms_db.checkinout ci JOIN adms_db.userinfo ui ON ui.userid = ci.userid
             WHERE ci.checktime >= %s AND ci.checktime < %s AND ui.badgenumber IN ({_PH(dnis)})""",
            (desde, hasta, *[str(x) for x in dnis]))
    except Exception as e:
        avisos.append(f"no pude leer las fichadas del reloj ({e})")
        return
    marcas = defaultdict(list)
    for r in cur.fetchall():
        try:
            marcas[int(r["dni"])].append((r["t"], str(r["ct"]).strip()))
        except (TypeError, ValueError):
            pass

    for dni, dias in dnis_dias.items():
        lista = sorted(marcas.get(dni, ()))
        tardes_mes = {}   # (anio, mes) -> [dias con llegada tarde, en orden]
        for a, m in {(d.year, d.month) for d in dias}:
            d, lst = date(a, m, 1), []
            while d.month == m:
                if es_tarde(entrada_del_dia(dni, d, lista)[2]):
                    lst.append(d)
                d += timedelta(days=1)
            tardes_mes[(a, m)] = lst
        for dia in dias:
            t, como, tarde = entrada_del_dia(dni, dia, lista)
            if not t:
                continue
            hora = t.strftime('%d/%m %H:%M')
            if tarde is not None and tarde > AUSENTE_DESDE_MIN:
                continue   # llego mas de 30 min tarde: es ausente
            if es_tarde(tarde):
                n = tardes_mes[(dia.year, dia.month)].index(dia) + 1
                if n >= TARDES_POR_AUSENTE:
                    continue   # desde la 3ra llegada tarde del mes, cada una es ausente
                motivos[(dni, dia)].append(
                    f"fichó la entrada {hora} ({como}; llegó {tarde} min tarde, {n}ª tarde del mes)")
            else:
                motivos[(dni, dia)].append(f"fichó la entrada {hora} ({como})")


def motivos_por_dia(cur, dnis_dias):
    """{(dni, dia): [motivos]} para los (dni, dia) pedidos. Devuelve (motivos, avisos)."""
    motivos, avisos = defaultdict(list), []
    if not dnis_dias:
        return motivos, avisos
    dnis = list(dnis_dias)
    dmin = min(d for ds in dnis_dias.values() for d in ds)
    dmax = max(d for ds in dnis_dias.values() for d in ds)
    fuentes = [
        ("SIAPE", f"""SELECT dni, fecha_desde AS desde, fecha_hasta AS hasta, novedad AS extra FROM historial
                      WHERE dni IN ({_PH(dnis)}) AND fecha_desde <= %s AND COALESCE(fecha_hasta, fecha_desde) >= %s
                        AND novedad NOT IN ('AUSENTE SIN AVISO', 'PRESENTE')""", (*dnis, dmax, dmin)),
        ("Ministerio", f"""SELECT dni, fecha_desde AS desde, fecha_hasta AS hasta, novedad AS extra
                      FROM ministerio_novedades_anual
                      WHERE dni IN ({_PH(dnis)}) AND fecha_desde <= %s AND fecha_hasta >= %s
                        AND COALESCE(codigo, '') <> '28'""", (*dnis, dmax, dmin)),
        ("Salud Laboral: reconocimiento médico", f"""SELECT dni, fecha_desde AS desde, fecha_hasta AS hasta, tipo AS extra
                      FROM reconocimientos_medicos
                      WHERE deleted_at IS NULL AND dni IN ({_PH(dnis)}) AND fecha_desde <= %s AND fecha_hasta >= %s
                        AND UPPER(COALESCE(resultado, '')) NOT REGEXP 'RECHAZ|DENEG|NO OTORG|NO APROB'""",
         (*dnis, dmax, dmin)),
        ("Salud Laboral: turno", f"""SELECT dni, fecha_turno AS desde, fecha_turno AS hasta FROM turnos_salud_laboral
                      WHERE deleted_at IS NULL AND dni IN ({_PH(dnis)}) AND fecha_turno BETWEEN %s AND %s""",
         (*dnis, dmin, dmax)),
        ("Salud Laboral: licencia", f"""SELECT dni, fecha_desde AS desde, fecha_hasta AS hasta FROM turnos_salud_laboral
                      WHERE deleted_at IS NULL AND dni IN ({_PH(dnis)}) AND fecha_desde <= %s AND fecha_hasta >= %s""",
         (*dnis, dmax, dmin)),
        ("Jefe: Art. 26", f"""SELECT dni, fecha AS desde, DATE_ADD(fecha, INTERVAL GREATEST(COALESCE(dias, 1), 1) - 1 DAY) AS hasta
                      FROM articulo_26 WHERE deleted_at IS NULL AND estado <> 'ANULADO' AND COALESCE(dias, 1) <= 60
                        AND dni IN ({_PH(dnis)}) AND fecha <= %s""", (*dnis, dmax)),
        ("Jefe: franco compensatorio", f"""SELECT dni, fecha_franco AS desde, fecha_franco AS hasta FROM francos_compensatorios
                      WHERE deleted_at IS NULL AND estado <> 'ANULADO' AND dni IN ({_PH(dnis)})
                        AND fecha_franco BETWEEN %s AND %s""", (*dnis, dmin, dmax)),
        ("Jefe: examen", f"""SELECT dni, fecha AS desde, fecha AS hasta FROM examen WHERE deleted_at IS NULL
                      AND dni IN ({_PH(dnis)}) AND fecha BETWEEN %s AND %s""", (*dnis, dmin, dmax)),
        ("Jefe: pre-examen", f"""SELECT dni, fecha AS desde, fecha AS hasta FROM prexamen WHERE deleted_at IS NULL
                      AND dni IN ({_PH(dnis)}) AND fecha BETWEEN %s AND %s""", (*dnis, dmin, dmax)),
        ("Jefe: Pap/Colpo", f"""SELECT dni, fecha AS desde, fecha AS hasta FROM papcolpo WHERE deleted_at IS NULL
                      AND dni IN ({_PH(dnis)}) AND fecha BETWEEN %s AND %s""", (*dnis, dmin, dmax)),
        ("Jefe: prácticas", f"""SELECT dni, fecha_desde AS desde,
                      DATE_ADD(fecha_desde, INTERVAL GREATEST(COALESCE(dias, 1), 1) - 1 DAY) AS hasta
                      FROM practicas_profesionales WHERE deleted_at IS NULL
                        AND COALESCE(estado, '') NOT IN ('ANULADO', 'RECHAZADO') AND COALESCE(dias, 1) <= 60
                        AND dni IN ({_PH(dnis)}) AND fecha_desde <= %s""", (*dnis, dmax)),
        ("Jefe: novedad", f"""SELECT dni, fecha AS desde, COALESCE(fecha_hasta, fecha) AS hasta, tipo AS extra
                      FROM novedad_jefe WHERE deleted_at IS NULL AND dni IN ({_PH(dnis)})
                        AND fecha <= %s AND COALESCE(fecha_hasta, fecha) >= %s""", (*dnis, dmax, dmin)),
        ("Rotación de residente", f"""SELECT dni, fecha AS desde, fecha AS hasta FROM rotacion_carga_siape
                      WHERE dni IN ({_PH(dnis)}) AND fecha BETWEEN %s AND %s
                        AND estado NOT IN ('ANULADO', 'BORRADO', 'BORRAR', 'ERROR_BORRAR', 'SOBRA')""",
         (*dnis, dmin, dmax)),
        ("Comisión de servicios", f"""SELECT dni, fecha_desde AS desde,
                      COALESCE(fecha_regreso, fecha_hasta, CURDATE()) AS hasta, destino AS extra
                      FROM agentes_comisiones WHERE deleted_at IS NULL AND dni IN ({_PH(dnis)})
                        AND fecha_desde <= %s""", (*dnis, dmax)),
        ("Vacaciones adelantadas", f"""SELECT dni, fecha_desde AS desde, fecha_hasta AS hasta FROM vacaciones_adelantadas
                      WHERE deleted_at IS NULL AND dni IN ({_PH(dnis)}) AND fecha_desde <= %s AND fecha_hasta >= %s""",
         (*dnis, dmax, dmin)),
    ]
    for etiqueta, sql, args in fuentes:
        try:
            _rangos(cur, sql, args, etiqueta, motivos, dnis_dias)
        except Exception as e:
            avisos.append(f"{etiqueta}: no se pudo revisar ({str(e)[:120]})")
    _fichadas(cur, dnis_dias, motivos, avisos)
    return motivos, avisos


def ya_cubiertos_por_28(cur, tabla, filas):
    """Ausentes cuyo(s) dia(s) ya estan cubiertos por un 28 del Ministerio de VARIOS dias (el
    comparador solo empareja rangos exactos y los da como 'solo SIAPE'). Se marcan OK sin intentar
    (si no, la Intranet da 'superpone'). Devuelve la cantidad (04/11/2026)."""
    dnis = sorted({int(f["dni"]) for f in filas if str(f["dni"]).isdigit()})
    if not dnis:
        return 0
    cur.execute(f"""SELECT dni, fecha_desde, fecha_hasta FROM ministerio_novedades_anual
                     WHERE codigo = '28' AND dni IN ({_PH(dnis)})""", tuple(dnis))
    r28 = defaultdict(list)
    for r in cur.fetchall():
        r28[int(r["dni"])].append((r["fecha_desde"], r["fecha_hasta"]))
    marcar_ = []
    for f in filas:
        if not str(f["dni"]).isdigit():
            continue
        h = f["hasta"] or f["desde"]
        cub = [(a, b) for a, b in r28.get(int(f["dni"]), []) if a <= f["desde"] and b >= h]
        if cub:
            a, b = cub[0]
            marcar_.append((f"Ya figura en el Ministerio: 28-INASISTENCIA {a:%d/%m/%Y} a {b:%d/%m/%Y} cubre el dia", f["id"]))
    if marcar_:
        cur.executemany(f"UPDATE {tabla} SET estado = 'OK', detalle = %s WHERE id = %s", marcar_)
    return len(marcar_)


def marcar(cur, tabla, filas):
    """filas: [{id, dni, desde, hasta, estado}] de ausentes abiertos o NO_ES_AUSENTE.
    Pasa a NO_ES_AUSENTE los que tienen motivo (algun dia del rango) y devuelve a PENDIENTE los
    NO_ES_AUSENTE que ya no lo tienen. Devuelve (marcados, vueltos, avisos)."""
    dnis_dias = defaultdict(set)
    for f in filas:
        try:
            dni = int(f["dni"])
        except (TypeError, ValueError):
            continue
        d = f["desde"]
        while d <= (f["hasta"] or f["desde"]):
            dnis_dias[dni].add(d)
            d += timedelta(days=1)
    motivos, avisos = motivos_por_dia(cur, dnis_dias)
    marcar_, volver = [], []
    for f in filas:
        try:
            dni = int(f["dni"])
        except (TypeError, ValueError):
            continue
        ms, d = [], f["desde"]
        while d <= (f["hasta"] or f["desde"]):
            ms += [m for m in motivos.get((dni, d), []) if m not in ms]
            d += timedelta(days=1)
        if ms:
            marcar_.append((("No es ausente: " + "; ".join(ms))[:500], f["id"]))
        elif f["estado"] == ESTADO:
            volver.append((f["id"],))
    if marcar_:
        cur.executemany(f"UPDATE {tabla} SET estado = '{ESTADO}', detalle = %s WHERE id = %s", marcar_)
    if volver:
        cur.executemany(f"UPDATE {tabla} SET estado = 'PENDIENTE', detalle = NULL WHERE id = %s", volver)
    return len(marcar_), len(volver), avisos
