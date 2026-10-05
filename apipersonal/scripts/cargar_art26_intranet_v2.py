"""
Carga del ARTICULO 26 2.0 en la Intranet MS como novedad FC / FRANCO COMPENSATORIO.

Diferencias con cargar_art26_intranet.py (version vieja, queda SIN USO como programa; de ahi
se reutilizan login / navegacion al plantel / control "ya cargada" / carga FC):
- No lee art26_export.xlsx: toma los Art. 26 directo de la base (articulo_26, sin borrados,
  ni ANULADO ni RECHAZADO, fecha valida) y los registra en la tabla art26_carga_intranet.
- El resultado de cada Art. 26 va a esa tabla (no a resultado_carga_art26*.xlsx). Los OK
  no se reintentan.
- Dependencia: cada Art. 26 tiene una dependencia sugerida (la del agente en la ultima
  corrida del Comparador 2.0; si no aparece, HOSPITAL). El run de una dependencia procesa
  los suyos y, ademas, los que otra dependencia ya descarto ("no pertenece a su plantel").
  Cuando la Intranet dice "no pertenece", esa dependencia queda en deps_descartadas.
- Registra la corrida en la pagina Robots como intranet_carga_art26_v2_<dep>.

Uso:
  python cargar_art26_intranet_v2.py --dependencia HOSPITAL
  python cargar_art26_intranet_v2.py --dependencia "UPA 4" --solo-cola   # lista, no carga
  python cargar_art26_intranet_v2.py --dependencia "UPA 18" --test      # solo el 1er DNI
"""

import argparse
import os
import sys
import time
from collections import defaultdict
from datetime import datetime

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN
import post_carga
import cargar_art26_intranet as V   # funciones de Intranet de la version vieja

TABLA = "art26_carga_intranet"
SCRIPT_ID = None   # lo fija main(): intranet_carga_art26_v2_<dep>
ESTADOS_EXCLUIDOS = ("ANULADO", "RECHAZADO")


def crear_tabla(cur):
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLA} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          art26_id BIGINT UNSIGNED NOT NULL,
          dni VARCHAR(12) NOT NULL,
          nombre VARCHAR(160) NOT NULL DEFAULT '',
          desde DATE NOT NULL,
          hasta DATE NOT NULL,
          estado_art26 VARCHAR(20) NOT NULL DEFAULT '',
          dependencia_sugerida VARCHAR(20) NOT NULL DEFAULT 'HOSPITAL',
          deps_descartadas VARCHAR(60) NOT NULL DEFAULT '' COMMENT 'dependencias donde la Intranet dijo "no pertenece" (CSV)',
          dependencia VARCHAR(20) NULL COMMENT 'dependencia del ultimo intento',
          estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE / OK / ERROR / ERROR_NAV / EXCEPCION / BAJA',
          label_intranet VARCHAR(200) NULL,
          detalle VARCHAR(500) NULL,
          intentos INT NOT NULL DEFAULT 0,
          cargado_en DATETIME NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_art26_carga_intranet__art26 (art26_id),
          KEY idx_art26_carga_intranet__estado (estado, dependencia_sugerida),
          CONSTRAINT fk_art26_carga_intranet__art26 FOREIGN KEY (art26_id)
            REFERENCES articulo_26 (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")


def sincronizar(cur):
    """Vuelca articulo_26 a la tabla de carga. Lo ya OK no se toca; si un Art. 26 pendiente
    cambio de fecha/dias se actualiza; si lo anularon/rechazaron/borraron queda BAJA."""
    excl = ",".join(f"'{e}'" for e in ESTADOS_EXCLUIDOS)
    cur.execute(f"""
        INSERT INTO {TABLA} (art26_id, dni, nombre, desde, hasta, estado_art26, dependencia_sugerida)
        SELECT a.id, CAST(a.dni AS CHAR),
               TRIM(CONCAT_WS(', ', NULLIF(TRIM(p.apellido), ''), NULLIF(TRIM(p.nombre), ''))),
               a.fecha, DATE_ADD(a.fecha, INTERVAL GREATEST(COALESCE(a.dias, 1), 1) - 1 DAY),
               a.estado,
               COALESCE((SELECT cn.dependencia FROM comparacion_novedades cn
                          WHERE cn.dni = CAST(a.dni AS CHAR) COLLATE utf8mb4_unicode_ci AND cn.dependencia IN ('HOSPITAL', 'UPA 4', 'UPA 18')
                          ORDER BY cn.corrida_id DESC LIMIT 1), 'HOSPITAL')
          FROM articulo_26 a
          LEFT JOIN personal p ON p.dni = a.dni
         WHERE a.deleted_at IS NULL AND a.estado NOT IN ({excl}) AND a.fecha >= '2000-01-01'
        ON DUPLICATE KEY UPDATE
          nombre = VALUES(nombre), estado_art26 = VALUES(estado_art26),
          dependencia_sugerida = VALUES(dependencia_sugerida),
          desde = IF({TABLA}.estado = 'OK', {TABLA}.desde, VALUES(desde)),
          hasta = IF({TABLA}.estado = 'OK', {TABLA}.hasta, VALUES(hasta)),
          estado = IF({TABLA}.estado = 'BAJA', 'PENDIENTE', {TABLA}.estado)""")
    cur.execute(f"""
        UPDATE {TABLA} t
          LEFT JOIN articulo_26 a ON a.id = t.art26_id
           SET t.estado = 'BAJA', t.detalle = 'El Art. 26 fue anulado, rechazado o borrado'
         WHERE t.estado NOT IN ('OK', 'BAJA')
           AND (a.id IS NULL OR a.deleted_at IS NOT NULL OR a.estado IN ({excl}))""")


def cargar_filas_db(dependencia, test_mode=False):
    with MN.conn() as cn, cn.cursor() as cur:
        crear_tabla(cur)
        sincronizar(cur)
        cn.commit()
        cur.execute(f"""
            SELECT art26_id, dni, nombre, desde, hasta
              FROM {TABLA}
             WHERE estado NOT IN ('OK', 'BAJA')
               AND NOT FIND_IN_SET(%s, deps_descartadas)
               AND (dependencia_sugerida = %s OR FIND_IN_SET(dependencia_sugerida, deps_descartadas))
             ORDER BY nombre, desde""", (dependencia, dependencia))
        filas = [{
            "art26_id": r["art26_id"], "Nombre": r["nombre"] or r["dni"], "DNI": int(r["dni"]),
            "Desde": r["desde"].strftime("%d/%m/%Y"), "Hasta": r["hasta"].strftime("%d/%m/%Y"),
        } for r in cur.fetchall()]
    if test_mode and filas:
        filas = [f for f in filas if f["DNI"] == filas[0]["DNI"]]
    return filas


def anotar(art26_id, dependencia, estado, label, detalle, no_pertenece=False):
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
                 WHERE art26_id = %s""",
                (estado[:20], (label or "")[:200] or None, (detalle or "")[:500] or None, dependencia,
                 estado == "OK", no_pertenece, dependencia, dependencia, art26_id))
            cn.commit()
    except Exception as e:
        print(f"  AVISO: no pude anotar el resultado en {TABLA}: {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--pass", dest="password")
    parser.add_argument("--dependencia", dest="dependencia", default="HOSPITAL")
    parser.add_argument("--solo-cola", action="store_true",
                        help="arma y lista los Art. 26 pendientes desde la base, sin abrir la Intranet")
    parser.add_argument("--label", dest="label", default=os.environ.get("INTRANET_FC_LABEL"))
    args = parser.parse_args()

    dependencia = args.dependencia.upper().replace("UPA4", "UPA 4").replace("UPA18", "UPA 18")
    if dependencia not in V.MAPA_DEP_CODIGO:
        print(f"ERROR: dependencia invalida '{args.dependencia}' (HOSPITAL / UPA 4 / UPA 18)")
        return
    global SCRIPT_ID
    SCRIPT_ID = f"intranet_carga_art26_v2_{MN.sufijo_dep(dependencia)}"
    script_desc = f"Carga de Art. 26 (FC) 2.0 en Intranet MS ({dependencia})"
    t0 = time.time()

    filas = cargar_filas_db(dependencia, test_mode=args.test)
    print(f"Art. 26 pendientes para {dependencia}: {len(filas)}")
    if args.solo_cola:
        for f in filas:
            print(f"  {f['DNI']}  {f['Nombre']}  {f['Desde']} -> {f['Hasta']}")
        return
    if not filas:
        MN.registrar_run(SCRIPT_ID, script_desc, "ok", motivo="Sin Art. 26 pendientes",
                         filas=0, archivo=TABLA, duracion_seg=int(time.time() - t0))
        return

    password = args.password or os.environ.get("INTRANET_PASS") or input("Contrasena: ")
    grupos = defaultdict(list)
    for f in filas:
        grupos[f["DNI"]].append(f)
    registros = []                                   # para script_run_items (pagina Robots)
    MN.items_desde_registros(SCRIPT_ID, registros, inicio=0)

    def resultado(f, estado, label, detalle, no_pertenece=False):
        anotar(f["art26_id"], dependencia, estado, label, detalle, no_pertenece)
        registros.append({"Nombre": f["Nombre"], "DNI": f["DNI"], "Novedad": label or "FC",
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

            for f in pendientes:
                if V.novedad_fc_ya_cargada(page, f["Desde"], f["Hasta"]):
                    print(f"  Ya estaba cargada FC: {f['Desde']} - {f['Hasta']}")
                    resultado(f, "OK", "FC", "Ya estaba cargada en la Intranet")
                    ok_count += 1
                    continue
                print(f"  Cargando FC: {f['Desde']} -> {f['Hasta']}")
                try:
                    exito, msg, real_label = V.cargar_novedad_fc(page, f["Desde"], f["Hasta"], args.label)
                    estado = "OK" if exito else "ERROR"
                    print(f"  {'OK - opcion: ' + str(real_label) if exito else 'ERROR: ' + str(msg)}")
                except Exception as e:
                    estado, msg, real_label = "EXCEPCION", str(e)[:200], "FC"
                    print(f"  EXCEPCION: {msg}")
                if estado == "OK":
                    ok_count += 1
                else:
                    err_count += 1
                resultado(f, estado, real_label or "FC", msg or "")
                try:
                    exito_nav2, _ = V.ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                    if not exito_nav2:
                        break
                except Exception:
                    break

        print(f"\nResultado total: {ok_count} OK, {err_count} errores.")
        print(f"Resultado anotado en la tabla {TABLA}")
        MN.registrar_run(SCRIPT_ID, script_desc, "ok",
                         motivo=f"{ok_count} Art. 26 cargados OK · {err_count} con error",
                         filas=ok_count, archivo=TABLA, duracion_seg=int(time.time() - t0))
        try:
            browser.close()
        except Exception:
            pass

    # navegador ya cerrado: archivo del Ministerio nuevo + comparacion contra SIAPE
    post_carga.actualizar_ministerio_y_comparar(dependencia, ok_count)


if __name__ == "__main__":
    main()
