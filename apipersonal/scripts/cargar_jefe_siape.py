"""
Carga en SiAPe como FRANCO COMPENSATORIO (COMUNICACIONES) lo que el jefe carga en su pagina
a los no titulares: Art. 26, examen, pre-examen, Pap/Colpo y practicas profesionales.

Reglas (definidas con el usuario, 18/10/2026):
  - Mismo tipo y mismo flujo que el robot de rotaciones / francos (cargar_francos_siape.py se
    reutiliza entero: login, Ficheros -> agente -> AUSENCIAS Y PRESENTES, guardado y avisos).
  - Un dia por fila (rango desde..hasta en dias corridos).
  - Solo fechas desde DESDE_MINIMO (septiembre 2026 en adelante). Se cargan los vencidos
    (fecha <= hoy); los futuros quedan PENDIENTE hasta que llegue el dia.
  - Permiso de salida NO entra (es por horas: como FC justificaria el dia entero).
  - Si SiAPe ya tiene otra novedad ese dia NO se reemplaza: queda YA_EXISTIA con el aviso.
    EXCEPCION (04/11/2026, pedido del usuario): si lo que hay es AUSENTE SIN AVISO (o PRESENTE) se
    CAMBIA a FC (F.reemplazar_dia: cambia el tipo, no borra). Antes se anota en jefe_siape_reemplazos.
    Los YA_EXISTIA cuyo dia figura AUSENTE SIN AVISO en SIAPE (ultima comparacion) vuelven a PENDIENTE.
  - Art. 26 / practicas de mas de MAX_DIAS dias = error de carga: no se generan.
  - (02/11/2026) Solo los dias que el agente TRABAJA: dia de la semana en su horario
    (horarios_historial, foto mas reciente <= fecha; si no hay, la primera) o feriado. Los demas
    (sabado/domingo de quien trabaja L-V, etc.) quedan NO_TRABAJA_DIA y no se cargan. Agente sin
    horario: se carga igual. Si ya estaba cargado (OK) queda BORRAR y el robot lo borra en SiAPe
    (solo si ese dia tiene un unico registro y es el franco) -> BORRADO. Si cambia el horario,
    vuelven solos (NO_TRABAJA_DIA/BORRADO -> PENDIENTE, BORRAR -> OK).

Tabla (se crea sola):
  jefe_carga_siape   UNIQUE dni+fecha (examen y Art. 26 el mismo dia no cargan dos veces);
                     origen + origen_id = de donde salio el dia.
                     estado PENDIENTE / OK / YA_EXISTIA / ERROR / SOBRA /
                            NO_TRABAJA_DIA / BORRAR / BORRADO
  Si el jefe borra/edita: los dias que ya no corresponden se borran si no estaban cargados;
  si ya estaban OK quedan SOBRA (borrarlos a mano en SiAPe).

Uso:
  python cargar_jefe_siape.py --solo-generar     # arma/actualiza la cola (no toca SiAPe)
  python cargar_jefe_siape.py --dry-run          # genera y muestra la cola
  python cargar_jefe_siape.py --dni 12345678 --max-dias 1
  python cargar_jefe_siape.py                    # carga toda la cola vencida
"""

import argparse
import os
import sys
import time
from collections import OrderedDict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN  # conn() + .env + script_run_items
import fc_fuera_horario as FH  # dias fuera del horario + borrado del FC en SiAPe

SCRIPT_ID = "siape_carga_jefe"
TABLA = "jefe_carga_siape"
NOVEDAD = "FRANCO COMPENSATORIO (COMUNICACIONES)"
MAX_INTENTOS_AUTO = 3      # los ERROR se reintentan solos hasta este numero de intentos
DESDE_MINIMO = date.fromisoformat(os.environ.get("JEFE_CARGA_DESDE", "2026-09-01"))
MAX_DIAS = 60
MAX_DIAS_NOVEDAD = 200     # novedad_jefe: una maternidad son ~90-120 dias
ESTADOS_EXCLUIDOS = ("ANULADO", "RECHAZADO")

_excl = ",".join(f"'{e}'" for e in ESTADOS_EXCLUIDOS)
# origen -> SELECT (id, dni, desde, hasta) de lo vivo
ORIGENES = OrderedDict([
    ("articulo_26", f"""
        SELECT id, dni, fecha AS desde,
               DATE_ADD(fecha, INTERVAL GREATEST(COALESCE(dias, 1), 1) - 1 DAY) AS hasta
          FROM articulo_26
         WHERE deleted_at IS NULL AND estado NOT IN ({_excl}) AND COALESCE(dias, 1) <= {MAX_DIAS}"""),
    ("practicas_profesionales", f"""
        SELECT id, dni, fecha_desde AS desde,
               DATE_ADD(fecha_desde, INTERVAL GREATEST(COALESCE(dias, 1), 1) - 1 DAY) AS hasta
          FROM practicas_profesionales
         WHERE deleted_at IS NULL AND COALESCE(estado, '') NOT IN ({_excl}) AND COALESCE(dias, 1) <= {MAX_DIAS}"""),
    ("examen", "SELECT id, dni, fecha AS desde, fecha AS hasta FROM examen WHERE deleted_at IS NULL"),
    ("prexamen", "SELECT id, dni, fecha AS desde, fecha AS hasta FROM prexamen WHERE deleted_at IS NULL"),
    ("papcolpo", "SELECT id, dni, fecha AS desde, fecha AS hasta FROM papcolpo WHERE deleted_at IS NULL"),
    # Novedades del jefe a becados (maternidad, duelo...; mig 107, 04/11/2026): en SIAPE van como FC,
    # en el Ministerio con su codigo real (cargar_jefe_intranet_v2). Maternidad pasa los 60 dias.
    ("novedad_jefe", f"""
        SELECT id, dni, fecha AS desde, COALESCE(fecha_hasta, fecha) AS hasta
          FROM novedad_jefe
         WHERE deleted_at IS NULL AND DATEDIFF(COALESCE(fecha_hasta, fecha), fecha) < {MAX_DIAS_NOVEDAD}"""),
])


def crear_tabla(cur):
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLA} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          origen VARCHAR(40) NOT NULL COMMENT 'articulo_26 / practicas_profesionales / examen / prexamen / papcolpo / novedad_jefe',
          origen_id BIGINT UNSIGNED NOT NULL,
          dni INT NOT NULL,
          fecha DATE NOT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE / OK / YA_EXISTIA / ERROR / SOBRA',
          detalle VARCHAR(500) NULL,
          intentos INT NOT NULL DEFAULT 0,
          cargado_en DATETIME NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_jefe_carga_siape__dni_fecha (dni, fecha),
          KEY idx_jefe_carga_siape__origen (origen, origen_id),
          KEY idx_jefe_carga_siape__estado (estado, fecha)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")


# ── generacion de la cola ─────────────────────────────────────────────────────

def generar(cn):
    """Recalcula los dias de todas las tablas del jefe y sincroniza la cola. Devuelve resumen."""
    deseado = OrderedDict()     # (dni, fecha) -> (origen, origen_id): el primero que lo pide
    por_origen = {}
    with cn.cursor() as cur:
        crear_tabla(cur)
        for origen, sql in ORIGENES.items():
            cur.execute(sql)
            n = 0
            for r in cur.fetchall():
                d, h = r["desde"], r["hasta"]
                if not d or not h or not r["dni"] or h < DESDE_MINIMO:
                    continue
                d = max(d, DESDE_MINIMO)
                while d <= h:
                    if deseado.setdefault((int(r["dni"]), d), (origen, r["id"])) == (origen, r["id"]):
                        n += 1
                    d += timedelta(days=1)
            por_origen[origen] = n
        no_trabaja = FH.dias_fuera_de_horario(cur, deseado)
    cn.commit()

    with cn.cursor() as cur:
        cur.execute(f"SELECT id, origen, origen_id, dni, fecha, estado FROM {TABLA}")
        actuales = {(int(x["dni"]), x["fecha"]): x for x in cur.fetchall()}

        nuevos = [(o, oid, dni, f, "NO_TRABAJA_DIA" if (dni, f) in no_trabaja else "PENDIENTE",
                   no_trabaja.get((dni, f)))
                  for (dni, f), (o, oid) in deseado.items() if (dni, f) not in actuales]
        if nuevos:
            cur.executemany(f"INSERT IGNORE INTO {TABLA} (origen, origen_id, dni, fecha, estado, detalle) "
                            f"VALUES (%s,%s,%s,%s,%s,%s)", nuevos)

        borrar, sobra, vuelve, reasignar = [], [], [], []
        a_estado = []           # (estado, detalle, id): cambios por el horario del agente
        for k, x in actuales.items():
            if k in deseado:
                if x["estado"] == "SOBRA":
                    vuelve.append(x["id"])
                o, oid = deseado[k]
                if (x["origen"], x["origen_id"]) != (o, oid):
                    reasignar.append((o, oid, x["id"]))
                motivo = no_trabaja.get(k)
                if motivo:
                    if x["estado"] in ("PENDIENTE", "ERROR"):
                        a_estado.append(("NO_TRABAJA_DIA", motivo, x["id"]))
                    elif x["estado"] == "OK":
                        a_estado.append(("BORRAR", f"{motivo}: lo cargo el robot, hay que borrarlo en SiAPe", x["id"]))
                elif x["estado"] in ("NO_TRABAJA_DIA", "BORRADO"):
                    a_estado.append(("PENDIENTE", None, x["id"]))        # cambio el horario
                elif x["estado"] in ("BORRAR", "ERROR_BORRAR"):
                    a_estado.append(("OK", None, x["id"]))               # todavia no se borro: queda
            elif x["estado"] in ("BORRAR", "ERROR_BORRAR"):
                pass            # el jefe lo saco y ademas no trabaja ese dia: se borra igual
            elif x["estado"] == "OK":
                sobra.append(x["id"])
            elif x["estado"] not in ("SOBRA", "BORRADO"):
                borrar.append(x["id"])          # nunca lo cargamos nosotros
        if borrar:
            cur.executemany(f"DELETE FROM {TABLA} WHERE id = %s", [(i,) for i in borrar])
        if sobra:
            cur.executemany(f"UPDATE {TABLA} SET estado='SOBRA', detalle='Cargado en SiAPe pero el jefe ya no lo tiene: borrarlo a mano' WHERE id = %s",
                            [(i,) for i in sobra])
        if vuelve:
            cur.executemany(f"UPDATE {TABLA} SET estado='OK', detalle=NULL WHERE id = %s", [(i,) for i in vuelve])
        if reasignar:
            cur.executemany(f"UPDATE {TABLA} SET origen=%s, origen_id=%s WHERE id = %s", reasignar)
        if a_estado:
            # intentos=0: un BORRAR / PENDIENTE nuevo arranca con sus reintentos completos
            cur.executemany(f"UPDATE {TABLA} SET estado=%s, detalle=%s, intentos=0 WHERE id = %s", a_estado)
    cn.commit()
    return {"dias": len(deseado), "nuevos": len(nuevos), "borrados": len(borrar),
            "sobra": len(sobra), "no_trabaja": len(no_trabaja),
            "a_borrar": sum(1 for e, _d, _i in a_estado if e == "BORRAR"), "por_origen": por_origen}



def traer_cola(cn, dni=None, limit_agentes=None):
    sql = f"""
        SELECT c.id, c.origen, c.origen_id, c.dni, c.fecha, c.intentos, p.cuil,
               TRIM(CONCAT(COALESCE(p.apellido,''), ' ', COALESCE(p.nombre,''))) AS nombre
          FROM {TABLA} c
          LEFT JOIN personal p ON p.dni = c.dni
         WHERE c.fecha <= CURDATE()
           AND (c.estado = 'PENDIENTE' OR (c.estado = 'ERROR' AND c.intentos < %s))"""
    params = [MAX_INTENTOS_AUTO]
    if dni:
        sql += " AND c.dni = %s"
        params.append(dni)
    sql += " ORDER BY c.dni, c.fecha"
    with cn.cursor() as cur:
        cur.execute(sql, params)
        filas = cur.fetchall()
    por_agente = OrderedDict()
    for f in filas:
        por_agente.setdefault(f["dni"], []).append(f)
    if limit_agentes:
        por_agente = OrderedDict(list(por_agente.items())[:limit_agentes])
    return por_agente


def traer_borrar(cn, dni=None):
    """Dias que el robot cargo y no corresponden (BORRAR), agrupados por agente."""
    sql = f"""
        SELECT c.id, c.dni, c.fecha, c.intentos, p.cuil,
               TRIM(CONCAT(COALESCE(p.apellido,''), ' ', COALESCE(p.nombre,''))) AS nombre
          FROM {TABLA} c
          LEFT JOIN personal p ON p.dni = c.dni
         WHERE c.estado = 'BORRAR' AND c.intentos < %s"""
    params = [FH.MAX_INTENTOS_BORRAR]
    if dni:
        sql += " AND c.dni = %s"
        params.append(dni)
    sql += " ORDER BY c.dni, c.fecha"
    with cn.cursor() as cur:
        cur.execute(sql, params)
        filas = cur.fetchall()
    por_agente = OrderedDict()
    for f in filas:
        por_agente.setdefault(f["dni"], []).append(f)
    return por_agente



TOCADAS = set()      # filas que esta corrida ya marco (para no pisarlas al anotar un corte)


def anotar(cn, ids, detalle):
    """Deja el motivo en filas que no se llegaron a procesar, SIN gastar intento ni
    cambiar el estado: se vuelven a tomar en la proxima corrida."""
    ids = [i for i in ids if i not in TOCADAS]
    if not ids:
        return
    with cn.cursor() as cur:
        cur.execute(
            f"UPDATE {TABLA} SET detalle=%s WHERE id IN ({','.join(['%s'] * len(ids))}) "
            f"AND estado IN ('PENDIENTE','ERROR','BORRAR')",
            [str(detalle)[:500], *ids])
    cn.commit()


def marcar(cn, fila_id, estado, detalle=None):
    TOCADAS.add(fila_id)
    with cn.cursor() as cur:
        cur.execute(
            f"UPDATE {TABLA} SET estado=%s, detalle=%s, intentos=intentos+1, "
            f"cargado_en=IF(%s='OK', NOW(), cargado_en) WHERE id=%s",
            (estado, (detalle or None) and str(detalle)[:500], estado, fila_id))
    cn.commit()


# ── main ──────────────────────────────────────────────────────────────────────

REEMPLAZABLES = ("AUSENTE SIN AVISO", "PRESENTE")   # lo unico que el robot del jefe cambia a FC

SQL_REEMPLAZOS = """
CREATE TABLE IF NOT EXISTS jefe_siape_reemplazos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cola_id BIGINT UNSIGNED NOT NULL COMMENT 'jefe_carga_siape.id',
  dni VARCHAR(20) NOT NULL,
  fecha DATE NOT NULL,
  tipo_anterior VARCHAR(150) NOT NULL,
  estado ENUM('PENDIENTE','CAMBIADO','FALLO','NO_REEMPLAZABLE') NOT NULL DEFAULT 'PENDIENTE',
  detalle VARCHAR(500) NULL,
  creado_en DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_jefe_siape_reemplazos_dni_fecha (dni, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


class NoReemplazable(Exception):
    pass


def reabrir_ya_existia_con_ausente(cn):
    """YA_EXISTIA cuyo dia en SIAPE (ultima comparacion 2.0) es AUSENTE SIN AVISO -> PENDIENTE."""
    with cn.cursor() as cur:
        cur.execute("SELECT MAX(id) AS id FROM comparacion_corridas")
        corrida = (cur.fetchone() or {}).get("id")
        if not corrida:
            return 0
        n = cur.execute(f"""
            UPDATE {TABLA} c
               SET c.estado = 'PENDIENTE', c.intentos = 0,
                   c.detalle = 'Reintento: en SIAPE ese dia figura AUSENTE SIN AVISO -> se cambia a FC'
             WHERE c.estado = 'YA_EXISTIA'
               AND EXISTS (SELECT 1 FROM comparacion_novedades n
                            WHERE n.corrida_id = %s AND n.novedad_siap = 'AUSENTE SIN AVISO'
                              AND n.dni = CAST(c.dni AS CHAR) COLLATE utf8mb4_unicode_ci
                              AND c.fecha BETWEEN n.desde_siap AND COALESCE(n.hasta_siap, n.desde_siap))""",
            (corrida,))
    cn.commit()
    return n


def instalar_reemplazos(F, cn):
    """F.reemplazar_dia anota lo que cambia en siape_carga_reemplazos (FK a reconocimientos medicos):
    para el jefe se redirige a jefe_siape_reemplazos y solo se permiten REEMPLAZABLES."""
    with cn.cursor() as cur:
        cur.execute(SQL_REEMPLAZOS)
    cn.commit()

    def anotar(cn_, cola_id, dni, dia, tipo_anterior):
        permitido = any(str(tipo_anterior).upper().startswith(t) for t in REEMPLAZABLES)
        with cn_.cursor() as cur:
            cur.execute("""INSERT INTO jefe_siape_reemplazos (cola_id, dni, fecha, tipo_anterior, estado, detalle)
                           VALUES (%s, %s, %s, %s, %s, %s)""",
                        (cola_id, str(dni), dia, str(tipo_anterior)[:150],
                         "PENDIENTE" if permitido else "NO_REEMPLAZABLE",
                         None if permitido else "No es ausente/presente: no se toca (queda para revisar)"))
            rid = cur.lastrowid
        cn_.commit()
        if not permitido:
            raise NoReemplazable(tipo_anterior)
        return rid

    def cerrar(cn_, rid, estado, detalle=None):
        with cn_.cursor() as cur:
            cur.execute("UPDATE jefe_siape_reemplazos SET estado=%s, detalle=%s WHERE id=%s",
                        (estado, (detalle or "")[:500] or None, rid))
        cn_.commit()

    F.anotar_reemplazo = anotar
    F.cerrar_reemplazo = cerrar


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo-generar", action="store_true", help="arma/actualiza la cola y sale")
    ap.add_argument("--dry-run", action="store_true", help="genera y muestra la cola, no toca SiAPe")
    ap.add_argument("--dni", type=int, help="solo los dias de este agente")
    ap.add_argument("--limit", type=int, help="procesar solo los primeros N agentes")
    ap.add_argument("--max-dias", type=int, help="cargar como mucho N dias por agente (prueba)")
    ap.add_argument("--sin-borrar", action="store_true", help="no borrar en SiAPe los dias BORRAR")
    ap.add_argument("--solo-borrar", action="store_true", help="solo borrar los dias BORRAR (no cargar)")
    args = ap.parse_args()

    cn = MN.conn()
    res = generar(cn)
    n_re = reabrir_ya_existia_con_ausente(cn)
    if n_re:
        print(f"{n_re} dia(s) YA_EXISTIA con AUSENTE SIN AVISO en SIAPE vuelven a PENDIENTE (se cambian a FC)")
    print(f"Cola generada (desde {DESDE_MINIMO:%d/%m/%Y}): {res['dias']} dias "
          f"({res['nuevos']} nuevos, {res['borrados']} quitados, {res['sobra']} sobran en SiAPe, "
          f"{res['no_trabaja']} fuera de horario, {res['a_borrar']} nuevos a borrar) - "
          + ", ".join(f"{k} {v}" for k, v in res["por_origen"].items()))
    if args.solo_generar:
        cn.close()
        return 0

    cola = OrderedDict() if args.solo_borrar else traer_cola(cn, dni=args.dni, limit_agentes=args.limit)
    total = sum(len(v) for v in cola.values())
    print(f"{len(cola)} agente(s), {total} dia(s) vencidos a cargar como {NOVEDAD}")
    for dni, filas in cola.items():
        f0 = filas[0]
        print(f"  {dni:<10} {f0['nombre'] or '?':<38} CUIL {f0['cuil'] or '?':<15} "
              f"{len(filas)}d: " + ", ".join(f"{x['fecha']:%d/%m}({x['origen'][:6]})" for x in filas[:10])
              + (" ..." if len(filas) > 10 else ""))
    a_borrar = OrderedDict() if args.sin_borrar else traer_borrar(cn, dni=args.dni)
    print(f"{len(a_borrar)} agente(s), {sum(len(v) for v in a_borrar.values())} dia(s) a BORRAR en SiAPe "
          f"(fuera de su horario)")
    for dni, filas in a_borrar.items():
        print(f"  {dni:<10} {filas[0]['nombre'] or '?':<38} " + ", ".join(f"{x['fecha']:%d/%m}" for x in filas))
    if args.dry_run or not (cola or a_borrar):
        if not (cola or a_borrar) and not args.dry_run:
            MN.registrar_run(SCRIPT_ID, "Carga de lo del jefe (FC) en SIAPE", "ok",
                             motivo="Sin días pendientes", filas=0, archivo=TABLA)
        cn.close()
        return 0

    import cargar_francos_siape as F
    instalar_reemplazos(F, cn)

    import pyautogui
    pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE
    pyautogui.PAUSE = F.PAUSA_CORTA

    hubo_error = False
    tot = {"ok": 0, "ya": 0, "err": 0}
    agentes_error = []
    corte = None
    err_s = F.entrar_siape()
    if err_s:
        corte = f"No pude entrar a SiAPe: {err_s}"

    for dni, filas in (cola.items() if not corte else []):
        try:
            nombre = filas[0]["nombre"]
            F.log(f"-- {dni} {nombre} ({len(filas)} dia/s) ---------------------")
            if not nombre:
                for x in filas:
                    marcar(cn, x["id"], "ERROR", "El DNI no está en personal: no lo puedo buscar en SiAPe")
                tot["err"] += len(filas)
                agentes_error.append(f"{dni} (sin nombre)")
                hubo_error = True
                continue
            try:
                F.abrir_agente_seguro(dni, filas[0]["cuil"], nombre)
            except F.SiapeCaido:
                raise
            except Exception as e:
                no_esta = isinstance(e, F.AgenteNoEncontrado)
                F.log(f"   {'NO ESTA EN SiAPe' if no_esta else 'ERROR buscando el agente'}: {e}")
                for x in filas:
                    marcar(cn, x["id"], "ERROR",
                           f"{'No está en SiAPe con ese DNI/nombre completo' if no_esta else 'No pude abrir el agente en SiAPe'}: {e}")
                MN.registrar_item(SCRIPT_ID, dni, nombre, "FC JEFE", f"{filas[0]['fecha']:%d/%m/%Y}",
                                  f"{filas[-1]['fecha']:%d/%m/%Y}", "error", f"No pude abrir el agente: {e}")
                hubo_error = True
                tot["err"] += len(filas)
                agentes_error.append(f"{dni} {nombre}")
                if no_esta:
                    try:
                        F.cerrar_modales()
                    except Exception as e2:
                        F.log(f"AVISO: no pude cerrar avisos: {e2}")
                else:
                    err_s = F.entrar_siape(cerrar_antes=True)
                    if err_s:
                        raise F.SiapeCaido(f"no pude volver a entrar a SiAPe: {err_s}")
                continue

            ok = ya = err = 0
            errores = []
            ficha_sucia = False
            for x in filas[: args.max_dias] if args.max_dias else filas:
                dia = x["fecha"]
                if ficha_sucia:
                    # un dia rechazado deja la ficha a medio completar: se reabre el agente limpio
                    try:
                        F.volver_a_ficheros()
                        F.abrir_agente_seguro(dni, filas[0]["cuil"], nombre)
                        ficha_sucia = False
                    except Exception as e:
                        marcar(cn, x["id"], "ERROR", f"{dia:%d/%m/%Y}: no pude reabrir el agente: {e}")
                        errores.append(f"{dia:%d/%m/%Y}: no pude reabrir el agente: {e}")
                        err += 1
                        break
                F.log(f"   cargando {dia:%d/%m/%Y} ({x['origen']})...")
                try:
                    cargo, motivo = F.cargar_dia_ausencia_agente(dia)
                except Exception as e:
                    marcar(cn, x["id"], "ERROR", f"{dia:%d/%m/%Y}: {e}")
                    errores.append(f"{dia:%d/%m/%Y}: {e}")
                    err += 1
                    F.log(f"   ERROR {dia:%d/%m/%Y}: {e} -> paso al siguiente agente")
                    break          # pantalla en estado desconocido: el agente siguiente reabre Ficheros
                if cargo:
                    marcar(cn, x["id"], "OK")
                    ok += 1
                    F.log(f"   OK   {dia:%d/%m/%Y}")
                elif "ya existia" in (motivo or "").lower():
                    # 04/11/2026: si lo que hay es AUSENTE SIN AVISO / PRESENTE se cambia a FC
                    ok_r, motivo_r = False, motivo
                    try:
                        ok_r, motivo_r, _tipo = F.reemplazar_dia(
                            cn, {"id": x["id"], "dni": dni}, dia,
                            reabrir=lambda: (F.volver_a_ficheros(),
                                             F.abrir_agente_seguro(dni, filas[0]["cuil"], nombre)))
                    except NoReemplazable as e:
                        motivo_r = f"{dia:%d/%m/%Y}: ya existia '{e}' (no es ausente): no se cambia, revisar"
                    except Exception as e:
                        motivo_r = f"{dia:%d/%m/%Y}: ya existia y no pude cambiarlo a FC: {e}"
                    if ok_r and motivo_r != "YA_ERA_FRANCO":
                        marcar(cn, x["id"], "OK", f"{dia:%d/%m/%Y}: {motivo_r}")
                        ok += 1
                        F.log(f"   OK   {dia:%d/%m/%Y} ({motivo_r})")
                    else:
                        marcar(cn, x["id"], "YA_EXISTIA", motivo if motivo_r == "YA_ERA_FRANCO" else motivo_r)
                        ya += 1
                        F.log(f"   YA   {motivo_r}")
                    ficha_sucia = True
                else:
                    marcar(cn, x["id"], "ERROR", motivo)
                    errores.append(motivo)
                    err += 1
                    ficha_sucia = True
                    F.log(f"   SKIP {motivo}")
            # dias que quedaron sin tocar porque se corto el agente: queda el motivo
            if errores:
                anotar(cn, [x["id"] for x in filas], f"No se llego a cargar: el agente se corto por {errores[-1]}")
            hubo_error = hubo_error or err > 0
            tot["ok"] += ok
            tot["ya"] += ya
            tot["err"] += err
            if err:
                agentes_error.append(f"{dni} {nombre}")
            MN.registrar_item(SCRIPT_ID, dni, nombre, "FC JEFE", f"{filas[0]['fecha']:%d/%m/%Y}",
                              f"{filas[-1]['fecha']:%d/%m/%Y}",
                              "ok" if not err and not ya else ("error" if err and not ok else "aviso"),
                              f"{ok} cargado(s), {ya} ya existían, {err} con error"
                              + (f": {'; '.join(errores)[:600]}" if errores else ""))

        except F.SiapeCaido as e:
            corte = f"SiAPe se cayo con {dni} {nombre} y no pude volver a entrar: {e}"
            break
        except Exception as e:
            # cualquier otra falla: queda anotada en este agente y sigo con el siguiente
            msg = f"{type(e).__name__}: {e}"
            F.log(f"   ERROR inesperado con {dni}: {msg} -> sigo con el siguiente")
            pend = [x["id"] for x in filas if x["id"] not in TOCADAS]
            for i in pend:
                marcar(cn, i, "ERROR", f"Falla del robot: {msg}")
            tot["err"] += len(pend)
            agentes_error.append(f"{dni} {nombre}")
            hubo_error = True
            err_s = F.entrar_siape(cerrar_antes=True)
            if err_s:
                corte = f"Despues del error con {dni} no pude volver a entrar a SiAPe: {err_s}"
                break

    # ── borrar en SiAPe lo que el robot cargo y no corresponde (fuera del horario) ──
    tot["borrados"] = tot["borrar_err"] = 0
    if a_borrar and not corte:
        rb = FH.procesar_borrados(
            F, a_borrar, lambda i, e, d: marcar(cn, i, e, d),
            registrar_item=lambda dni, nombre, fs: MN.registrar_item(
                SCRIPT_ID, dni, nombre, "BORRAR FC", f"{fs[0]['fecha']:%d/%m/%Y}",
                f"{fs[-1]['fecha']:%d/%m/%Y}", "ok", "borrado fuera de horario"))
        tot["borrados"], tot["borrar_err"] = rb["borrados"], rb["errores"]
        agentes_error += rb["agentes_error"]
        corte = rb["corte"]
    hubo_error = hubo_error or tot["borrar_err"] > 0

    sin_procesar = 0
    if corte:
        hubo_error = True
        ids = [x["id"] for fs in [*cola.values(), *a_borrar.values()] for x in fs if x["id"] not in TOCADAS]
        sin_procesar = len(ids)
        anotar(cn, ids, f"No se proceso: {corte}")
        F.log(f"CORTE: {corte} ({sin_procesar} dia/s quedan pendientes con el motivo anotado)")

    cn.close()
    F.log("Listo.")
    F.log(f"RESUMEN: {tot['ok']} cargado(s), {tot['ya']} ya existian, {tot['err']} con error"
          + (f", {sin_procesar} sin procesar" if sin_procesar else "")
          + (f", {tot['borrados']} borrado(s) fuera de horario" if tot["borrados"] else "")
          + (f", {tot['borrar_err']} sin poder borrar" if tot["borrar_err"] else "")
          + (f" | agentes con error: {', '.join(dict.fromkeys(agentes_error))[:250]}" if agentes_error else "")
          + (f" | {corte[:200]}" if corte else ""))
    return 1 if hubo_error else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Cancelado a mano (Ctrl+C).")
        sys.exit(130)
