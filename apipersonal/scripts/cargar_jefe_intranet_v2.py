"""
Carga en la Intranet MS como FC / FRANCO COMPENSATORIO lo que el jefe carga en su pagina a
los no titulares (examen, pre-examen, Pap/Colpo, practicas profesionales).

Reglas (definidas con el usuario, 18/10/2026):
- Todo va como FC (34 - FRANCO COMPENSATORIO), mismo flujo que el Art. 26 2.0: se reutilizan
  login / navegacion al plantel / control "ya cargada" / carga FC de cargar_art26_intranet.py.
- El Art. 26 NO entra aca: ya lo sube cargar_art26_intranet_v2.py (tabla art26_carga_intranet).
- Permiso de salida NO entra: es por horas, como FC justificaria el dia entero.
- Solo fechas desde DESDE_MINIMO (septiembre 2026 en adelante).
- Tabla jefe_carga_intranet: una fila por registro de origen (UNIQUE origen+origen_id).
  OK no se reintenta; PERIODO_CERRADO no se reintenta salvo que cambien las fechas; si el
  jefe lo borra (o anula) queda BAJA.
- Dependencia: la del DNI en la ultima corrida del Comparador 2.0 (si no aparece, HOSPITAL);
  "no pertenece" agrega la dependencia a deps_descartadas y la prueba la siguiente.
- Registra la corrida en la pagina Robots como intranet_carga_jefe_v2_<dep>.
- Rangos (24/10/2026): los dias SEGUIDOS del mismo agente van en UNA carga FC desde-hasta,
  sin importar el origen (pre-examen del 7 + examen del 8 -> 07 a 08). La tabla sigue con una
  fila por registro: el OK se anota en cada una. Si el rango da error (incluido periodo
  cerrado) se reintenta registro por registro.

Uso:
  python cargar_jefe_intranet_v2.py --dependencia HOSPITAL
  python cargar_jefe_intranet_v2.py --dependencia "UPA 4" --solo-cola   # lista, no carga
  python cargar_jefe_intranet_v2.py --dependencia "UPA 18" --test      # solo el 1er DNI
"""

import argparse
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN

TABLA = "jefe_carga_intranet"
SCRIPT_ID = None   # lo fija main(): intranet_carga_jefe_v2_<dep>
DESDE_MINIMO = os.environ.get("JEFE_CARGA_DESDE", "2026-09-01")
ESTADOS_EXCLUIDOS = ("ANULADO", "RECHAZADO")
MAX_DIAS = 60      # un registro de mas dias es un error de carga (p.ej. 1.882.026 dias): no se sube

# origen -> SELECT con (origen_id, dni, desde, hasta, vivo). `vivo`=0 => BAJA.
_excl = ",".join(f"'{e}'" for e in ESTADOS_EXCLUIDOS)
ORIGENES = {
    "examen": "SELECT id, dni, fecha AS desde, fecha AS hasta, deleted_at IS NULL AS vivo FROM examen",
    "prexamen": "SELECT id, dni, fecha AS desde, fecha AS hasta, deleted_at IS NULL AS vivo FROM prexamen",
    "papcolpo": "SELECT id, dni, fecha AS desde, fecha AS hasta, deleted_at IS NULL AS vivo FROM papcolpo",
    "practicas_profesionales": f"""
        SELECT id, dni, fecha_desde AS desde,
               DATE_ADD(fecha_desde, INTERVAL GREATEST(COALESCE(dias, 1), 1) - 1 DAY) AS hasta,
               (deleted_at IS NULL AND COALESCE(estado, '') NOT IN ({_excl})
                AND COALESCE(dias, 1) <= {MAX_DIAS}) AS vivo
          FROM practicas_profesionales""",
}


def crear_tabla(cur):
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLA} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          origen VARCHAR(40) NOT NULL COMMENT 'tabla de la pagina del jefe: examen / prexamen / papcolpo / practicas_profesionales',
          origen_id BIGINT UNSIGNED NOT NULL,
          dni VARCHAR(12) NOT NULL,
          nombre VARCHAR(160) NOT NULL DEFAULT '',
          desde DATE NOT NULL,
          hasta DATE NOT NULL,
          dependencia_sugerida VARCHAR(20) NOT NULL DEFAULT 'HOSPITAL',
          deps_descartadas VARCHAR(60) NOT NULL DEFAULT '' COMMENT 'dependencias donde la Intranet dijo "no pertenece" (CSV)',
          dependencia VARCHAR(20) NULL COMMENT 'dependencia del ultimo intento',
          estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE / OK / ERROR / ERROR_NAV / EXCEPCION / BAJA / PERIODO_CERRADO',
          label_intranet VARCHAR(200) NULL,
          detalle VARCHAR(500) NULL,
          intentos INT NOT NULL DEFAULT 0,
          cargado_en DATETIME NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_jefe_carga_intranet__origen (origen, origen_id),
          KEY idx_jefe_carga_intranet__estado (estado, dependencia_sugerida),
          KEY idx_jefe_carga_intranet__dni (dni)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")


def sincronizar(cur):
    """Vuelca las tablas del jefe a la cola. Lo OK no se toca; si un pendiente cambio de fechas
    se actualiza; si lo borraron/anularon queda BAJA."""
    for origen, sql in ORIGENES.items():
        cur.execute(f"""
            INSERT INTO {TABLA} (origen, origen_id, dni, nombre, desde, hasta, dependencia_sugerida)
            SELECT %s, o.id, CAST(o.dni AS CHAR),
                   TRIM(CONCAT_WS(', ', NULLIF(TRIM(p.apellido), ''), NULLIF(TRIM(p.nombre), ''))),
                   o.desde, o.hasta,
                   COALESCE((SELECT cn.dependencia FROM comparacion_novedades cn
                              WHERE cn.dni = CAST(o.dni AS CHAR) COLLATE utf8mb4_unicode_ci
                                AND cn.dependencia IN ('HOSPITAL', 'UPA 4', 'UPA 18')
                              ORDER BY cn.corrida_id DESC LIMIT 1), 'HOSPITAL')
              FROM ({sql}) o
              LEFT JOIN personal p ON p.dni = o.dni
             WHERE o.vivo AND o.desde >= %s AND o.hasta >= o.desde
            ON DUPLICATE KEY UPDATE
              nombre = VALUES(nombre),
              dependencia_sugerida = VALUES(dependencia_sugerida),
              -- va ANTES que desde/hasta: MySQL asigna en orden y aca necesita las fechas viejas
              estado = IF({TABLA}.estado = 'BAJA'
                          OR ({TABLA}.estado = 'PERIODO_CERRADO'
                              AND ({TABLA}.desde <> VALUES(desde) OR {TABLA}.hasta <> VALUES(hasta))),
                          'PENDIENTE', {TABLA}.estado),
              desde = IF({TABLA}.estado = 'OK', {TABLA}.desde, VALUES(desde)),
              hasta = IF({TABLA}.estado = 'OK', {TABLA}.hasta, VALUES(hasta))""",
            (origen, DESDE_MINIMO))
        cur.execute(f"""
            UPDATE {TABLA} t
              LEFT JOIN ({sql}) o ON o.id = t.origen_id
               SET t.estado = 'BAJA', t.detalle = 'El jefe lo borro o anulo'
             WHERE t.origen = %s AND t.estado NOT IN ('OK', 'BAJA')
               AND (o.id IS NULL OR NOT o.vivo)""", (origen,))


def cargar_filas_db(dependencia, test_mode=False):
    with MN.conn() as cn, cn.cursor() as cur:
        crear_tabla(cur)
        sincronizar(cur)
        cn.commit()
        cur.execute(f"""
            SELECT id, origen, dni, nombre, desde, hasta
              FROM {TABLA}
             WHERE estado NOT IN ('OK', 'BAJA', 'PERIODO_CERRADO')   -- periodo cerrado: no se reintenta
               AND NOT FIND_IN_SET(%s, deps_descartadas)
               AND (dependencia_sugerida = %s OR FIND_IN_SET(dependencia_sugerida, deps_descartadas))
             ORDER BY nombre, desde""", (dependencia, dependencia))
        filas = [{
            "id": r["id"], "origen": r["origen"], "Nombre": r["nombre"] or r["dni"], "DNI": int(r["dni"]),
            "Desde": r["desde"].strftime("%d/%m/%Y"), "Hasta": r["hasta"].strftime("%d/%m/%Y"),
        } for r in cur.fetchall()]
    if test_mode and filas:
        filas = [f for f in filas if f["DNI"] == filas[0]["DNI"]]
    return filas


def anotar(fila_id, dependencia, estado, label, detalle, no_pertenece=False):
    try:
        with MN.conn() as cn, cn.cursor() as cur:
            cur.execute(f"""
                UPDATE {TABLA}
                   SET estado = %s, label_intranet = %s, detalle = %s, dependencia = %s,
                       intentos = intentos + 1,
                       cargado_en = IF(%s, NOW(), cargado_en),
                       deps_descartadas = IF(%s AND NOT FIND_IN_SET(%s, deps_descartadas),
                                             TRIM(BOTH ',' FROM CONCAT(deps_descartadas, ',', %s)),
                                             deps_descartadas)
                 WHERE id = %s""",
                (estado[:20], (label or "")[:200] or None, (detalle or "")[:500] or None, dependencia,
                 estado == "OK", no_pertenece, dependencia, dependencia, fila_id))
            cn.commit()
    except Exception as e:
        print(f"  AVISO: no pude anotar el resultado en {TABLA}: {e}")


def _fecha(ddmmyyyy):
    return datetime.strptime(ddmmyyyy, "%d/%m/%Y").date()


def juntar_seguidos(pendientes):
    """Agrupa los pendientes de UN agente cuyos dias son seguidos (todo va como FC, sin importar
    el origen). Devuelve listas de filas en orden de fecha; una lista de 1 = carga suelta."""
    grupos = []
    for f in sorted(pendientes, key=lambda f: _fecha(f["Desde"])):
        if grupos and _fecha(f["Desde"]) == _fecha(grupos[-1][-1]["Hasta"]) + timedelta(days=1):
            grupos[-1].append(f)
        else:
            grupos.append([f])
    return grupos


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--pass", dest="password")
    parser.add_argument("--dependencia", dest="dependencia", default="HOSPITAL")
    parser.add_argument("--solo-cola", action="store_true",
                        help="arma y lista los pendientes desde la base, sin abrir la Intranet")
    parser.add_argument("--label", dest="label", default=os.environ.get("INTRANET_FC_LABEL"))
    args = parser.parse_args()

    import cargar_art26_intranet as V   # funciones de Intranet (login, plantel, carga FC)
    dependencia = args.dependencia.upper().replace("UPA4", "UPA 4").replace("UPA18", "UPA 18")
    if dependencia not in V.MAPA_DEP_CODIGO:
        print(f"ERROR: dependencia invalida '{args.dependencia}' (HOSPITAL / UPA 4 / UPA 18)")
        return
    global SCRIPT_ID
    SCRIPT_ID = f"intranet_carga_jefe_v2_{MN.sufijo_dep(dependencia)}"
    script_desc = f"Carga de lo del jefe (FC) en Intranet MS ({dependencia})"
    t0 = time.time()

    filas = cargar_filas_db(dependencia, test_mode=args.test)
    print(f"Pendientes del jefe para {dependencia} (desde {DESDE_MINIMO}): {len(filas)}")
    if args.solo_cola:
        for f in filas:
            print(f"  {f['DNI']}  {f['Nombre']}  {f['origen']:<24} {f['Desde']} -> {f['Hasta']}")
        return
    if not filas:
        MN.registrar_run(SCRIPT_ID, script_desc, "ok", motivo="Sin pendientes",
                         filas=0, archivo=TABLA, duracion_seg=int(time.time() - t0))
        return

    from playwright.sync_api import sync_playwright
    import post_carga
    from cargar_novedades_intranet_v2 import es_error_cierre

    password = args.password or os.environ.get("INTRANET_PASS") or input("Contrasena: ")
    grupos = defaultdict(list)
    for f in filas:
        grupos[f["DNI"]].append(f)
    registros = []                                   # para script_run_items (pagina Robots)
    MN.items_desde_registros(SCRIPT_ID, registros, inicio=0)

    def resultado(f, estado, label, detalle, no_pertenece=False):
        anotar(f["id"], dependencia, estado, label, detalle, no_pertenece)
        registros.append({"Nombre": f["Nombre"], "DNI": f["DNI"], "Novedad": f"{label or 'FC'} ({f['origen']})",
                          "Desde": f["Desde"], "Hasta": f["Hasta"], "Estado": estado, "Detalle": detalle})
        MN.items_desde_registros(SCRIPT_ID, registros)

    ok_count = err_count = 0
    with sync_playwright() as p:
        browser, page = V.nueva_pagina(p)
        print("Iniciando sesion...")
        try:
            V.login(page, password, dependencia)
        except Exception as e:
            print(f"ERROR en login/cambio dependencia: {e}")
            browser.close()
            MN.registrar_run(SCRIPT_ID, script_desc, "error", motivo=f"Login/dependencia: {e}"[:480],
                             archivo=TABLA, duracion_seg=int(time.time() - t0))
            return
        print("Sesion iniciada.\n")

        for i, (dni, pendientes) in enumerate(grupos.items(), 1):
            nombre = pendientes[0]["Nombre"]
            print(f"[{i}/{len(grupos)}] {nombre} (DNI {dni}) - {len(pendientes)} pendiente(s)")
            try:
                page.title()
            except Exception:
                print("  Browser cerrado, reabriendo...")
                try:
                    browser.close()
                except Exception:
                    pass
                browser, page = V.nueva_pagina(p)
                try:
                    V.login(page, password, dependencia)
                except Exception as e:
                    print(f"  Re-login fallo: {e}")
                    break

            exito_nav, msg_nav = V.ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
            if not exito_nav:
                no_pert = "no pertenece" in str(msg_nav or "").lower()
                for f in pendientes:
                    resultado(f, "ERROR_NAV", "FC", msg_nav, no_pertenece=no_pert)
                    err_count += 1
                continue

            def intentar(desde, hasta, que):
                """Una carga FC desde-hasta en la ficha abierta -> (estado, label, detalle, cargo).
                `cargo`=True si se uso el formulario (hay que volver a abrir la ficha)."""
                if V.novedad_fc_ya_cargada(page, desde, hasta):
                    print(f"  Ya estaba cargada FC: {desde} - {hasta}")
                    return "OK", "FC", "Ya estaba cargada en la Intranet", False
                print(f"  Cargando FC ({que}): {desde} -> {hasta}")
                try:
                    exito, msg, real_label = V.cargar_novedad_fc(page, desde, hasta, args.label)
                    estado = "OK" if exito else ("PERIODO_CERRADO" if es_error_cierre(msg) else "ERROR")
                    print(f"  {'OK - opcion: ' + str(real_label) if exito else 'ERROR: ' + str(msg)}")
                except Exception as e:
                    estado, msg, real_label = "EXCEPCION", str(e)[:200], "FC"
                    print(f"  EXCEPCION: {msg}")
                return estado, real_label or "FC", msg or "", True

            def reabrir_ficha():
                try:
                    return V.ir_a_novedades(page, dni, password, dependencia, nombre=nombre)[0]
                except Exception:
                    return False

            seguir = True
            for grupo in juntar_seguidos(pendientes):
                if not seguir:
                    break
                if len(grupo) > 1:
                    desde, hasta = grupo[0]["Desde"], grupo[-1]["Hasta"]
                    origenes = " + ".join(f["origen"] for f in grupo)
                    estado, label, detalle, cargo = intentar(desde, hasta, f"rango: {origenes}")
                    if estado == "OK":
                        for f in grupo:
                            resultado(f, "OK", label,
                                      f"Cargado en rango {desde} a {hasta} ({len(grupo)} registros). {detalle}".strip())
                            ok_count += 1
                        if cargo and not reabrir_ficha():
                            break
                        continue
                    print(f"  El rango dio error: reintento uno por uno ({len(grupo)} registros)")
                    if cargo and not reabrir_ficha():
                        break
                for f in grupo:
                    estado, label, detalle, cargo = intentar(f["Desde"], f["Hasta"], f["origen"])
                    if estado == "OK":
                        ok_count += 1
                    else:
                        err_count += 1
                    resultado(f, estado, label, detalle)
                    if cargo and not reabrir_ficha():
                        seguir = False
                        break

        print(f"\nResultado total: {ok_count} OK, {err_count} errores.")
        print(f"Resultado anotado en la tabla {TABLA}")
        MN.registrar_run(SCRIPT_ID, script_desc, "ok",
                         motivo=f"{ok_count} cargados OK como FC · {err_count} con error",
                         filas=ok_count, archivo=TABLA, duracion_seg=int(time.time() - t0))
        try:
            browser.close()
        except Exception:
            pass

    # navegador ya cerrado: archivo del Ministerio nuevo + comparacion contra SIAPE
    post_carga.actualizar_ministerio_y_comparar(dependencia, ok_count)


if __name__ == "__main__":
    main()
