"""
Carga en SiAPe como FRANCO COMPENSATORIO (COMUNICACIONES) los dias de ROTACION de los
residentes (tabla residentes_rotacion, pagina /app/residentes-rotacion).

Reglas (definidas con el usuario, 05/10/2026):
  - Mismo tipo y mismo flujo que el robot de francos (cargar_francos_siape.py, se reutiliza
    entero: login, Ficheros -> agente -> AUSENCIAS Y PRESENTES, guardado y avisos).
  - Solo los DIAS DE ROTACION: el rango desde..hasta filtrado por los dias de la semana del
    campo `dias` ("Lunes a Viernes", "jueves", "LUNES Y JUEVES", "miercoles a sabado"...).
  - Si la rotacion no tiene `dias` (o no se entienden), se usan los dias con turno del
    agente en HORARIOS.xlsx (EXCEL_ASISTENCIA_DIR). Sin eso tampoco -> no se genera nada y
    la rotacion queda "revisar dias" en la pagina.
  - Se cargan los atrasados; los dias futuros quedan PENDIENTE hasta que llegue la fecha.
    Rotacion sin `hasta` -> se genera hasta hoy.

Tablas (se crean solas):
  rotacion_carga_siape      un dia a cargar por fila (UNIQUE dni+fecha: dos rotaciones
                            superpuestas del mismo agente no cargan el dia dos veces)
                            estado PENDIENTE / OK / YA_EXISTIA / ERROR / SOBRA
  rotacion_siape_generacion por rotacion: de donde salieron los dias y avisos

Edicion/borrado de rotaciones: al regenerar, los dias que ya no corresponden se borran si no
estaban cargados; si ya estaban OK quedan SOBRA (borrarlos a mano en SiAPe: el robot nunca
borra en SiAPe). Un SOBRA que vuelve a corresponder vuelve a OK.

Uso:
  python cargar_rotaciones_siape.py --solo-generar     # arma/actualiza la cola (no toca SiAPe)
  python cargar_rotaciones_siape.py --dry-run          # genera y muestra la cola
  python cargar_rotaciones_siape.py --rotacion 7 --max-dias 1
  python cargar_rotaciones_siape.py                    # carga toda la cola vencida
"""

import argparse
import datetime as dt
import os
import re
import sys
import unicodedata
from collections import OrderedDict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN  # conn() + .env + script_run_items

SCRIPT_ID = "siape_carga_rotaciones"
TABLA = "rotacion_carga_siape"
TABLA_GEN = "rotacion_siape_generacion"
NOVEDAD = "FRANCO COMPENSATORIO (COMUNICACIONES)"
MAX_INTENTOS_AUTO = 3      # los ERROR se reintentan solos hasta este numero de intentos

DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]  # weekday() 0..6
ABREV = {"lun": 0, "mar": 1, "mie": 2, "jue": 3, "vie": 4, "sab": 5, "dom": 6}


# ── tablas ────────────────────────────────────────────────────────────────────

def crear_tablas(cur):
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLA} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          rotacion_id INT NOT NULL,
          dni INT NOT NULL,
          fecha DATE NOT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE / OK / YA_EXISTIA / ERROR / SOBRA',
          detalle VARCHAR(500) NULL,
          intentos INT NOT NULL DEFAULT 0,
          cargado_en DATETIME NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_rotacion_carga_siape__dni_fecha (dni, fecha),
          KEY idx_rotacion_carga_siape__rotacion (rotacion_id),
          KEY idx_rotacion_carga_siape__estado (estado, fecha),
          CONSTRAINT fk_rotacion_carga_siape__rotacion FOREIGN KEY (rotacion_id)
            REFERENCES residentes_rotacion (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLA_GEN} (
          rotacion_id INT NOT NULL,
          origen_dias VARCHAR(20) NOT NULL COMMENT 'ROTACION / HORARIO / NINGUNO',
          dias_semana VARCHAR(80) NOT NULL DEFAULT '' COMMENT 'lunes,martes,...',
          aviso VARCHAR(300) NULL,
          generado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (rotacion_id),
          CONSTRAINT fk_rotacion_siape_generacion__rotacion FOREIGN KEY (rotacion_id)
            REFERENCES residentes_rotacion (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")


# ── dias de la semana ─────────────────────────────────────────────────────────

def _norm(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def parsear_dias(texto):
    """'Lunes a Viernes' / 'LUNES Y JUEVES' / 'miercoles a sabado' / 'lunes martes y miercoles'
    -> set de weekday() (0=lunes). None si no se reconoce ningun dia."""
    t = _norm(texto)
    toks = re.findall(r"[a-z]+", t)
    out, prev, rango = set(), None, False
    for tok in toks:
        d = ABREV.get(tok[:3]) if len(tok) >= 3 else None
        if d is not None and tok[:3] == "mar" and tok.startswith("marz"):
            d = None
        if d is not None:
            if rango and prev is not None:
                i = prev
                while True:
                    out.add(i)
                    if i == d:
                        break
                    i = (i + 1) % 7
            out.add(d)
            prev, rango = d, False
        elif tok in ("a", "al", "hasta"):
            rango = prev is not None
        elif tok in ("todos", "todo") and "dia" in t:
            return set(range(7))
    return out or None


def _hora(v):
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return f"{v.hour:02d}:{v.minute:02d}"
    if isinstance(v, dt.time):
        return f"{v.hour:02d}:{v.minute:02d}"
    if isinstance(v, (int, float)) and 0 <= v < 1.0001:      # fraccion de dia
        m = round(float(v) * 24 * 60)
        return f"{(m // 60) % 24:02d}:{m % 60:02d}"
    m = re.search(r"(\d{1,2}):(\d{2})", str(v))
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def leer_horarios():
    """{dni: set(weekday)} con los dias en que EMPIEZA un turno (mismo criterio que
    armarTurnos: la cola de una noche que cruza 00:00 no cuenta como otro dia)."""
    d = os.environ.get("EXCEL_ASISTENCIA_DIR", "").strip()
    out = {}
    if not d or not os.path.isdir(d):
        return out, f"EXCEL_ASISTENCIA_DIR no configurado o inexistente ({d})"
    try:
        import openpyxl
    except ImportError:
        return out, "falta openpyxl"
    archivos = [f for f in os.listdir(d) if "horario" in f.lower() and re.search(r"\.xls[xm]$", f, re.I)
                and not f.startswith("~$")]
    for fn in archivos:
        wb = openpyxl.load_workbook(os.path.join(d, fn), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        for i, r in enumerate(ws.iter_rows(values_only=True)):
            if i == 0 or not r or len(r) < 18:
                continue
            dni = re.sub(r"\D", "", str(r[3] or "")).lstrip("0")
            if not dni:
                continue
            sem = [(_hora(r[4 + 2 * k]), _hora(r[5 + 2 * k])) for k in range(7)]
            colas = {(k + 1) % 7 for k in range(7)
                     if sem[k][0] and sem[k][1] == "00:00" and sem[(k + 1) % 7][0] == "00:00" and sem[(k + 1) % 7][1]}
            out[dni] = {k for k in range(7) if k not in colas and sem[k][0] and sem[k][1]}
        wb.close()
    return out, None


# ── generacion de la cola ─────────────────────────────────────────────────────

def generar(cn):
    """Recalcula los dias de todas las rotaciones vivas y sincroniza la tabla. Devuelve resumen."""
    hoy = date.today()
    with cn.cursor() as cur:
        crear_tablas(cur)
        cur.execute("""
            SELECT id, dni, fecha_desde, fecha_hasta, dias
              FROM residentes_rotacion
             WHERE deleted_at IS NULL
             ORDER BY id""")
        rots = cur.fetchall()
    cn.commit()

    horarios, err_hor = None, None
    deseado = {}            # (dni, fecha) -> rotacion_id (la primera que lo pide)
    gen = []                # (rotacion_id, origen, dias_semana, aviso)
    for r in rots:
        dias = parsear_dias(r["dias"])
        origen, aviso = "ROTACION", None
        if dias is None:
            if horarios is None:
                horarios, err_hor = leer_horarios()
            dias = horarios.get(str(r["dni"]))
            origen = "HORARIO"
            base = "sin días cargados" if not str(r["dias"] or "").strip() else f"no entiendo los días '{r['dias']}'"
            if dias:
                aviso = f"{base}: se usan los días de su horario"
            else:
                origen, dias = "NINGUNO", set()
                aviso = f"{base} y no tiene horario en HORARIOS.xlsx" + (f" ({err_hor})" if err_hor else "")
        hasta = r["fecha_hasta"] or hoy
        d = r["fecha_desde"]
        while d <= hasta:
            if d.weekday() in dias:
                deseado.setdefault((int(r["dni"]), d), r["id"])
            d += timedelta(days=1)
        gen.append((r["id"], origen, ",".join(DIAS[k] for k in sorted(dias)), aviso))

    with cn.cursor() as cur:
        cur.execute(f"SELECT id, rotacion_id, dni, fecha, estado FROM {TABLA}")
        actuales = {(int(x["dni"]), x["fecha"]): x for x in cur.fetchall()}

        nuevos = [(rid, dni, f) for (dni, f), rid in deseado.items() if (dni, f) not in actuales]
        if nuevos:
            cur.executemany(f"INSERT IGNORE INTO {TABLA} (rotacion_id, dni, fecha) VALUES (%s,%s,%s)", nuevos)

        borrar, sobra, vuelve, reasignar = [], [], [], []
        for k, x in actuales.items():
            if k in deseado:
                if x["estado"] == "SOBRA":
                    vuelve.append(x["id"])
                if x["rotacion_id"] != deseado[k] and x["estado"] in ("PENDIENTE", "ERROR"):
                    reasignar.append((deseado[k], x["id"]))
            elif x["estado"] in ("OK", "YA_EXISTIA", "SOBRA"):
                if x["estado"] == "OK":
                    sobra.append(x["id"])
                elif x["estado"] == "YA_EXISTIA":
                    borrar.append(x["id"])      # nunca lo cargamos nosotros
            else:
                borrar.append(x["id"])
        if borrar:
            cur.executemany(f"DELETE FROM {TABLA} WHERE id = %s", [(i,) for i in borrar])
        if sobra:
            cur.executemany(f"UPDATE {TABLA} SET estado='SOBRA', detalle='Cargado en SiAPe pero ya no es día de rotación: borrarlo a mano' WHERE id = %s",
                            [(i,) for i in sobra])
        if vuelve:
            cur.executemany(f"UPDATE {TABLA} SET estado='OK', detalle=NULL WHERE id = %s", [(i,) for i in vuelve])
        if reasignar:
            cur.executemany(f"UPDATE {TABLA} SET rotacion_id=%s WHERE id = %s", reasignar)

        cur.execute(f"DELETE FROM {TABLA_GEN}")
        if gen:
            cur.executemany(f"INSERT INTO {TABLA_GEN} (rotacion_id, origen_dias, dias_semana, aviso) VALUES (%s,%s,%s,%s)", gen)
    cn.commit()
    return {"rotaciones": len(rots), "dias": len(deseado), "nuevos": len(nuevos), "borrados": len(borrar),
            "sobra": len(sobra), "sin_dias": sum(1 for g in gen if g[1] == "NINGUNO")}


def traer_cola(cn, rotacion=None, limit_agentes=None):
    sql = f"""
        SELECT c.id, c.rotacion_id, c.dni, c.fecha, c.intentos, p.cuil,
               TRIM(CONCAT(COALESCE(p.apellido,''), ' ', COALESCE(p.nombre,''))) AS nombre
          FROM {TABLA} c
          JOIN residentes_rotacion rr ON rr.id = c.rotacion_id AND rr.deleted_at IS NULL
          LEFT JOIN personal p ON p.dni = c.dni
         WHERE c.fecha <= CURDATE()
           AND (c.estado = 'PENDIENTE' OR (c.estado = 'ERROR' AND c.intentos < %s))"""
    params = [MAX_INTENTOS_AUTO]
    if rotacion:
        sql += " AND c.rotacion_id = %s"
        params.append(rotacion)
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


def marcar(cn, fila_id, estado, detalle=None):
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
    ap.add_argument("--rotacion", type=int, help="solo los dias de esta rotacion (id)")
    ap.add_argument("--limit", type=int, help="procesar solo los primeros N agentes")
    ap.add_argument("--max-dias", type=int, help="cargar como mucho N dias por agente (prueba)")
    args = ap.parse_args()

    cn = MN.conn()
    res = generar(cn)
    print(f"Cola generada: {res['rotaciones']} rotaciones, {res['dias']} dias de rotacion "
          f"({res['nuevos']} nuevos, {res['borrados']} quitados, {res['sobra']} sobran en SiAPe, "
          f"{res['sin_dias']} rotaciones sin dias)")
    if args.solo_generar:
        cn.close()
        return 0

    cola = traer_cola(cn, rotacion=args.rotacion, limit_agentes=args.limit)
    total = sum(len(v) for v in cola.values())
    print(f"{len(cola)} agente(s), {total} dia(s) vencidos a cargar como {NOVEDAD}")
    for dni, filas in cola.items():
        f0 = filas[0]
        print(f"  {dni:<10} {f0['nombre'] or '?':<38} CUIL {f0['cuil'] or '?':<15} "
              f"{len(filas)}d: " + ", ".join(f"{x['fecha']:%d/%m}" for x in filas[:12])
              + (" ..." if len(filas) > 12 else ""))
    if args.dry_run or not cola:
        cn.close()
        return 0

    import cargar_francos_siape as F

    import pyautogui
    pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE
    pyautogui.PAUSE = F.PAUSA_CORTA

    F.asegurar_sesion()
    F.cerrar_modales()
    F.ventana_siape()

    hubo_error = False
    for dni, filas in cola.items():
        nombre = filas[0]["nombre"]
        F.log(f"-- {dni} {nombre} ({len(filas)} dia/s) ---------------------")
        if not nombre:
            for x in filas:
                marcar(cn, x["id"], "ERROR", "El DNI no está en personal: no lo puedo buscar en SiAPe")
            hubo_error = True
            continue
        try:
            F.seleccionar_agente_ausencias(filas[0]["cuil"], nombre)
        except Exception as e:
            F.log(f"   ERROR buscando el agente: {e}")
            for x in filas:
                marcar(cn, x["id"], "ERROR", f"No pude abrir el agente en SiAPe: {e}")
            MN.registrar_item(SCRIPT_ID, dni, nombre, "FC ROTACION", f"{filas[0]['fecha']:%d/%m/%Y}",
                              f"{filas[-1]['fecha']:%d/%m/%Y}", "error", f"No pude abrir el agente: {e}")
            hubo_error = True
            try:
                F.cerrar_modales()
            except Exception:
                pass
            continue

        ok = ya = err = 0
        errores = []
        for x in filas[: args.max_dias] if args.max_dias else filas:
            dia = x["fecha"]
            F.log(f"   cargando {dia:%d/%m/%Y}...")
            try:
                cargo, motivo = F.cargar_dia_ausencia_agente(dia)
            except Exception as e:
                marcar(cn, x["id"], "ERROR", f"{dia:%d/%m/%Y}: {e}")
                errores.append(f"{dia:%d/%m/%Y}: {e}")
                err += 1
                F.log(f"   ERROR {dia:%d/%m/%Y}: {e} -> paso al siguiente agente")
                break          # la pantalla quedo en estado desconocido: el agente siguiente reabre Ficheros
            if cargo:
                marcar(cn, x["id"], "OK")
                ok += 1
                F.log(f"   OK   {dia:%d/%m/%Y}")
            elif "ya existia" in (motivo or "").lower():
                marcar(cn, x["id"], "YA_EXISTIA", motivo)
                ya += 1
                F.log(f"   YA   {motivo}")
            else:
                marcar(cn, x["id"], "ERROR", motivo)
                errores.append(motivo)
                err += 1
                F.log(f"   SKIP {motivo}")
        hubo_error = hubo_error or err > 0
        MN.registrar_item(SCRIPT_ID, dni, nombre, "FC ROTACION", f"{filas[0]['fecha']:%d/%m/%Y}",
                          f"{filas[-1]['fecha']:%d/%m/%Y}",
                          "ok" if not err and not ya else ("error" if err and not ok else "aviso"),
                          f"{ok} cargado(s), {ya} ya existían, {err} con error"
                          + (f": {'; '.join(errores)[:600]}" if errores else ""))

    cn.close()
    F.log("Listo.")
    return 1 if hubo_error else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Cancelado a mano (Ctrl+C).")
        sys.exit(130)
