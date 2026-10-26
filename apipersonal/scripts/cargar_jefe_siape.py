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
  - Art. 26 / practicas de mas de MAX_DIAS dias = error de carga: no se generan.

Tabla (se crea sola):
  jefe_carga_siape   UNIQUE dni+fecha (examen y Art. 26 el mismo dia no cargan dos veces);
                     origen + origen_id = de donde salio el dia.
                     estado PENDIENTE / OK / YA_EXISTIA / ERROR / SOBRA
  Si el jefe borra/edita: los dias que ya no corresponden se borran si no estaban cargados;
  si ya estaban OK quedan SOBRA (borrarlos a mano en SiAPe: el robot nunca borra).

Uso:
  python cargar_jefe_siape.py --solo-generar     # arma/actualiza la cola (no toca SiAPe)
  python cargar_jefe_siape.py --dry-run          # genera y muestra la cola
  python cargar_jefe_siape.py --dni 12345678 --max-dias 1
  python cargar_jefe_siape.py                    # carga toda la cola vencida
"""

import argparse
import os
import sys
from collections import OrderedDict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN  # conn() + .env + script_run_items

SCRIPT_ID = "siape_carga_jefe"
TABLA = "jefe_carga_siape"
NOVEDAD = "FRANCO COMPENSATORIO (COMUNICACIONES)"
MAX_INTENTOS_AUTO = 3      # los ERROR se reintentan solos hasta este numero de intentos
DESDE_MINIMO = date.fromisoformat(os.environ.get("JEFE_CARGA_DESDE", "2026-09-01"))
MAX_DIAS = 60
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
])


def crear_tabla(cur):
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLA} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          origen VARCHAR(40) NOT NULL COMMENT 'articulo_26 / practicas_profesionales / examen / prexamen / papcolpo',
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
    cn.commit()

    with cn.cursor() as cur:
        cur.execute(f"SELECT id, origen, origen_id, dni, fecha, estado FROM {TABLA}")
        actuales = {(int(x["dni"]), x["fecha"]): x for x in cur.fetchall()}

        nuevos = [(o, oid, dni, f) for (dni, f), (o, oid) in deseado.items() if (dni, f) not in actuales]
        if nuevos:
            cur.executemany(f"INSERT IGNORE INTO {TABLA} (origen, origen_id, dni, fecha) VALUES (%s,%s,%s,%s)", nuevos)

        borrar, sobra, vuelve, reasignar = [], [], [], []
        for k, x in actuales.items():
            if k in deseado:
                if x["estado"] == "SOBRA":
                    vuelve.append(x["id"])
                o, oid = deseado[k]
                if (x["origen"], x["origen_id"]) != (o, oid):
                    reasignar.append((o, oid, x["id"]))
            elif x["estado"] == "OK":
                sobra.append(x["id"])
            elif x["estado"] != "SOBRA":
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
    cn.commit()
    return {"dias": len(deseado), "nuevos": len(nuevos), "borrados": len(borrar),
            "sobra": len(sobra), "por_origen": por_origen}


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
            f"AND estado IN ('PENDIENTE','ERROR')",
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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo-generar", action="store_true", help="arma/actualiza la cola y sale")
    ap.add_argument("--dry-run", action="store_true", help="genera y muestra la cola, no toca SiAPe")
    ap.add_argument("--dni", type=int, help="solo los dias de este agente")
    ap.add_argument("--limit", type=int, help="procesar solo los primeros N agentes")
    ap.add_argument("--max-dias", type=int, help="cargar como mucho N dias por agente (prueba)")
    args = ap.parse_args()

    cn = MN.conn()
    res = generar(cn)
    print(f"Cola generada (desde {DESDE_MINIMO:%d/%m/%Y}): {res['dias']} dias "
          f"({res['nuevos']} nuevos, {res['borrados']} quitados, {res['sobra']} sobran en SiAPe) - "
          + ", ".join(f"{k} {v}" for k, v in res["por_origen"].items()))
    if args.solo_generar:
        cn.close()
        return 0

    cola = traer_cola(cn, dni=args.dni, limit_agentes=args.limit)
    total = sum(len(v) for v in cola.values())
    print(f"{len(cola)} agente(s), {total} dia(s) vencidos a cargar como {NOVEDAD}")
    for dni, filas in cola.items():
        f0 = filas[0]
        print(f"  {dni:<10} {f0['nombre'] or '?':<38} CUIL {f0['cuil'] or '?':<15} "
              f"{len(filas)}d: " + ", ".join(f"{x['fecha']:%d/%m}({x['origen'][:6]})" for x in filas[:10])
              + (" ..." if len(filas) > 10 else ""))
    if args.dry_run or not cola:
        if not cola and not args.dry_run:
            MN.registrar_run(SCRIPT_ID, "Carga de lo del jefe (FC) en SIAPE", "ok",
                             motivo="Sin días pendientes", filas=0, archivo=TABLA)
        cn.close()
        return 0

    import cargar_francos_siape as F

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
                    marcar(cn, x["id"], "YA_EXISTIA", motivo)
                    ya += 1
                    ficha_sucia = True
                    F.log(f"   YA   {motivo}")
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

    sin_procesar = 0
    if corte:
        hubo_error = True
        ids = [x["id"] for fs in cola.values() for x in fs if x["id"] not in TOCADAS]
        sin_procesar = len(ids)
        anotar(cn, ids, f"No se proceso: {corte}")
        F.log(f"CORTE: {corte} ({sin_procesar} dia/s quedan pendientes con el motivo anotado)")

    cn.close()
    F.log("Listo.")
    F.log(f"RESUMEN: {tot['ok']} cargado(s), {tot['ya']} ya existian, {tot['err']} con error"
          + (f", {sin_procesar} sin procesar" if sin_procesar else "")
          + (f" | agentes con error: {', '.join(dict.fromkeys(agentes_error))[:250]}" if agentes_error else "")
          + (f" | {corte[:200]}" if corte else ""))
    return 1 if hubo_error else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Cancelado a mano (Ctrl+C).")
        sys.exit(130)
