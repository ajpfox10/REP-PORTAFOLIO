"""
Carga en la Intranet MS lo que el jefe carga en su pagina a los no titulares.
04/11/2026 (pedido del usuario): en SIAPE todo va como FC (cargar_jefe_siape.py), pero en el
Ministerio cada cosa va con su CODIGO REAL (LABEL_POR_ORIGEN): examen 18, pre-examen 17,
practicas 45, permiso de salida 43 (con las horas), novedad_jefe = la opcion que eligio el jefe
(maternidad, duelo...; mig 107). Pap/Colpo sigue como FC (34): el DF viene de SIAPE. Art. 26 va como 261 en su propio robot.
Reglas anteriores (18/10/2026; "todo como FC" quedo solo para papcolpo):

Reglas (definidas con el usuario, 18/10/2026):
- Todo va como FC (34 - FRANCO COMPENSATORIO), mismo flujo que el Art. 26 2.0: se reutilizan
  login / navegacion al plantel / control "ya cargada" / carga FC de cargar_art26_intranet.py.
- El Art. 26 NO entra aca: ya lo sube cargar_art26_intranet_v2.py (tabla art26_carga_intranet).
- (viejo) Permiso de salida no entraba; desde 04/11/2026 entra como 43 con las horas.
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
MAX_DIAS_NOVEDAD = 200   # novedad_jefe: una maternidad son ~90-120 dias

# Codigo REAL con el que va cada origen al Ministerio (04/11/2026: en SIAPE sigue como FC, en la
# Intranet el codigo de verdad). None = FC (34) como antes: papcolpo (el DF viene de SIAPE).
# novedad_jefe usa la opcion que eligio el jefe (columna tipo); permiso_salida = 43 con las horas.
LABEL_POR_ORIGEN = {
    "examen": "18 - POR EXAMEN",
    "prexamen": "17 - POR PRE-EXAMEN",
    "practicas_profesionales": "45 - POR PRACTICAS OBLIGAORIAS",
    "permiso_salida": "43 - PERMISO HORAS DE SALIDA",
    "papcolpo": None,
}

ORIGENES = {
    "novedad_jefe": f"""
        SELECT id, dni, fecha AS desde, COALESCE(fecha_hasta, fecha) AS hasta,
               (deleted_at IS NULL AND DATEDIFF(COALESCE(fecha_hasta, fecha), fecha) < {MAX_DIAS_NOVEDAD}) AS vivo
          FROM novedad_jefe""",
    "permiso_salida": "SELECT id, dni, fecha AS desde, fecha AS hasta, deleted_at IS NULL AS vivo FROM permiso_salida",
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
          origen VARCHAR(40) NOT NULL COMMENT 'tabla de la pagina del jefe: examen / prexamen / papcolpo / practicas_profesionales / permiso_salida / novedad_jefe',
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


def label_de(origen, tipo_jefe=None):
    """Opcion del combo de la Intranet para el origen; None = FC (34)."""
    if origen == "novedad_jefe":
        return (tipo_jefe or "").strip() or None
    return LABEL_POR_ORIGEN.get(origen)


def horas_permiso(hora_desde, hora_hasta, por_defecto=2):
    """Horas enteras del permiso de salida (redondeo para arriba); sin horario -> 2 hs."""
    def minutos(t):
        if t is None:
            return None
        if isinstance(t, timedelta):
            return int(t.total_seconds() // 60)
        hh, mm = str(t).split(":")[:2]
        return int(hh) * 60 + int(mm)
    a, b = minutos(hora_desde), minutos(hora_hasta)
    if a is None or b is None or b <= a:
        return por_defecto
    return max(1, -(-(b - a) // 60))


def cargar_filas_db(dependencia, test_mode=False):
    with MN.conn() as cn, cn.cursor() as cur:
        crear_tabla(cur)
        sincronizar(cur)
        cn.commit()
        cur.execute(f"""
            SELECT t.id, t.origen, t.dni, t.nombre, t.desde, t.hasta,
                   nj.tipo AS tipo_jefe, ps.hora_desde, ps.hora_hasta
              FROM {TABLA} t
              LEFT JOIN novedad_jefe nj ON t.origen = 'novedad_jefe' AND nj.id = t.origen_id
              LEFT JOIN permiso_salida ps ON t.origen = 'permiso_salida' AND ps.id = t.origen_id
             WHERE t.estado NOT IN ('OK', 'BAJA', 'PERIODO_CERRADO')   -- periodo cerrado: no se reintenta
               AND NOT FIND_IN_SET(%s, t.deps_descartadas)
               AND (t.dependencia_sugerida = %s OR FIND_IN_SET(t.dependencia_sugerida, t.deps_descartadas))
             ORDER BY t.nombre, t.desde""", (dependencia, dependencia))
        filas = [{
            "id": r["id"], "origen": r["origen"], "Nombre": r["nombre"] or r["dni"], "DNI": int(r["dni"]),
            "Desde": r["desde"].strftime("%d/%m/%Y"), "Hasta": r["hasta"].strftime("%d/%m/%Y"),
            "Label": label_de(r["origen"], r["tipo_jefe"]),
            "Horas": horas_permiso(r["hora_desde"], r["hora_hasta"]) if r["origen"] == "permiso_salida" else None,
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
    """Agrupa los pendientes de UN agente cuyos dias son seguidos y van con la MISMA opcion
    (FC con FC, 18 con 18...). El permiso de salida (por horas) va siempre suelto.
    Devuelve listas de filas en orden de fecha; una lista de 1 = carga suelta."""
    grupos = []
    for f in sorted(pendientes, key=lambda f: _fecha(f["Desde"])):
        if (grupos and f.get("Horas") is None and grupos[-1][-1].get("Horas") is None
                and f.get("Label") == grupos[-1][-1].get("Label")
                and _fecha(f["Desde"]) == _fecha(grupos[-1][-1]["Hasta"]) + timedelta(days=1)):
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
    parser.add_argument("--mes", help="AAAA-MM: solo las que EMPIEZAN en ese mes")
    args = parser.parse_args()

    import cargar_art26_intranet as V   # funciones de Intranet (login, plantel, carga FC)
    dependencia = args.dependencia.upper().replace("UPA4", "UPA 4").replace("UPA18", "UPA 18")
    if dependencia not in V.MAPA_DEP_CODIGO:
        print(f"ERROR: dependencia invalida '{args.dependencia}' (HOSPITAL / UPA 4 / UPA 18)")
        return
    global SCRIPT_ID
    SCRIPT_ID = f"intranet_carga_jefe_v2_{MN.sufijo_dep(dependencia)}"
    script_desc = f"Carga de lo del jefe en Intranet MS ({dependencia})"
    t0 = time.time()

    filas = cargar_filas_db(dependencia, test_mode=args.test)
    if args.mes:
        filas = [f for f in filas if f"{f['Desde'][6:10]}-{f['Desde'][3:5]}" == args.mes]
        print(f"Filtro --mes {args.mes}: solo las que empiezan en ese mes")
    print(f"Pendientes del jefe para {dependencia} (desde {DESDE_MINIMO}): {len(filas)}")
    if args.solo_cola:
        for f in filas:
            extra = f"  ({f['Horas']} hs)" if f.get("Horas") else ""
            print(f"  {f['DNI']}  {f['Nombre']}  {f['origen']:<24} {f['Desde']} -> {f['Hasta']}"
                  f"  => {f['Label'] or 'FC (34)'}{extra}")
        return
    if not filas:
        MN.registrar_run(SCRIPT_ID, script_desc, "ok", motivo="Sin pendientes",
                         filas=0, archivo=TABLA, duracion_seg=int(time.time() - t0))
        return

    from playwright.sync_api import sync_playwright
    import post_carga
    import cargar_novedades_intranet_v2 as IV2   # carga con codigo real (cargar_novedad / horas)
    import intranet_liberar_28 as L28            # borra 28 que pisan la carga (04/11/2026)
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
                    resultado(f, "ERROR_NAV", f.get("Label") or "FC", msg_nav, no_pertenece=no_pert)
                    err_count += 1
                continue

            def _intentar(desde, hasta, que, label=None, horas=None):
                """Una carga desde-hasta en la ficha abierta -> (estado, label, detalle, cargo).
                label None = FC (34); si no, la opcion exacta del combo (codigo real).
                `cargo`=True si se uso el formulario (hay que volver a abrir la ficha)."""
                if label:
                    if IV2.ya_cargada_igual(page, label, desde, hasta):
                        print(f"  Ya estaba cargada {label}: {desde} - {hasta}")
                        return "OK", label, "Ya estaba cargada en la Intranet", False
                    print(f"  Cargando {label} ({que}): {desde} -> {hasta}"
                          + (f" [{horas} hs]" if horas else ""))
                    try:
                        if horas:
                            IV2.HORAS_BOLETA = horas
                        exito, msg = IV2.cargar_novedad(page, label, desde, hasta)
                        estado = "OK" if exito else ("PERIODO_CERRADO" if es_error_cierre(msg) else "ERROR")
                        print(f"  {'OK' if exito else 'ERROR: ' + str(msg)}")
                    except Exception as e:
                        estado, msg = "EXCEPCION", str(e)[:200]
                        print(f"  EXCEPCION: {msg}")
                    finally:
                        IV2.HORAS_BOLETA = 2
                    return estado, label, msg or "", True
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

            def intentar(desde, hasta, que, label=None, horas=None):
                """_intentar + (04/11/2026) si da "superpone" y lo que pisa son 28 (ausentes), los
                borra (intranet_liberar_28) y reintenta una vez. Si pisa otra cosa no toca nada."""
                estado, lab, detalle, cargo = _intentar(desde, hasta, que, label, horas)
                if estado != "ERROR" or "superpone" not in (detalle or "").lower():
                    return estado, lab, detalle, cargo
                try:
                    if not V.ir_a_novedades(page, dni, password, dependencia, nombre=nombre)[0]:
                        return estado, lab, detalle, False
                    borrados, otros = L28.liberar_28(page, dni, desde, hasta, f"{label or 'FC'} del jefe ({que})")
                    if otros:
                        return estado, lab, f"{detalle} | Se superpone con: {'; '.join(otros)[:250]} (no es 28: no se toca)", False
                    if not borrados or not V.ir_a_novedades(page, dni, password, dependencia, nombre=nombre)[0]:
                        return estado, lab, detalle, False
                    print(f"  {borrados} 28 borrado(s): reintento")
                    e2, l2, d2, c2 = _intentar(desde, hasta, que, label, horas)
                    return e2, l2, f"Se borro {borrados} 28 (ausente) que pisaba la carga. {d2}".strip(), c2
                except Exception as e:
                    return estado, lab, f"{detalle} | no pude liberar los 28: {e}"[:480], False

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
                    estado, label, detalle, cargo = intentar(desde, hasta, f"rango: {origenes}", grupo[0].get("Label"))
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
                    estado, label, detalle, cargo = intentar(f["Desde"], f["Hasta"], f["origen"], f.get("Label"), f.get("Horas"))
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
                         motivo=f"{ok_count} cargados OK (codigo real; papcolpo como FC) · {err_count} con error",
                         filas=ok_count, archivo=TABLA, duracion_seg=int(time.time() - t0))
        try:
            browser.close()
        except Exception:
            pass

    # navegador ya cerrado: archivo del Ministerio nuevo + comparacion contra SIAPE
    post_carga.actualizar_ministerio_y_comparar(dependencia, ok_count)


if __name__ == "__main__":
    main()
