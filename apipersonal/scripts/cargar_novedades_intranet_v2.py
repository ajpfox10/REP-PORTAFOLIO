r"""
Carga de novedades 2.0 en la Intranet del Ministerio de Salud (copia de
cargar_vacaciones_intranet.py, que queda como version vieja).

Diferencias con la vieja:
- Lee los pendientes de la BASE, no de errores_siape*.xlsx: la ultima corrida del
  Comparador 2.0 (comparacion_novedades), estado SOLO_SIAP, sin BECARIO_NO_APLICA, de la
  dependencia del run.
- Anota el resultado de cada novedad en la tabla novedades_carga_intranet (una fila por
  dni + novedad SIAPE + desde + hasta), no en resultado_carga*.xlsx. Las que ya estan OK no
  se vuelven a intentar aunque sigan apareciendo en otra comparacion.
- Registra en la pagina Robots como intranet_carga_novedades_v2_<dep>.
La carga en si (mapeo, CIE, E-pendiente, maximo mensual, superposicion) es la misma.

Uso:
    python cargar_novedades_intranet_v2.py --dependencia HOSPITAL
    python cargar_novedades_intranet_v2.py --dependencia "UPA 4" --solo-cola   # lista, no carga
    python cargar_novedades_intranet_v2.py --dependencia "UPA 18" --test      # solo el 1er DNI
"""

import os, sys, json, argparse, time, re
import pandas as pd
from collections import defaultdict
from pathlib import Path
import unicodedata
from datetime import date, datetime, timedelta
from playwright.sync_api import sync_playwright, Error as PWError

# Mapeo por tabla `mapeo_novedades` (+ regla de CIE) y registro en script_runs
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN
import post_carga

# Forzar UTF-8 en la consola: evita que print() de '→', acentos, etc. crashee
# en CMD con codepage cp1252 (UnicodeEncodeError 'charmap').
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

URL_LOGIN   = "https://sistemas.ms.gba.gov.ar/intranet/login.php"
URL_PLANTEL = "https://sistemas.ms.gba.gov.ar/partenovedades/web/app.php/plantel/"
BASE_URL    = "https://sistemas.ms.gba.gov.ar"
USUARIO     = os.environ.get("INTRANET_USER", "xxxxxxx")
CHROME_PROFILE_DIR = os.environ.get("INTRANET_CHROME_PROFILE", r"D:\G\comparacion\intranet_chrome_profile")

# ── Helpers ─────────────────────────────────────────────────────────────────

def fmt_fecha(val):
    if pd.isnull(val):
        return None
    if isinstance(val, str):
        val = pd.to_datetime(val)
    return val.strftime("%d/%m/%Y")

def build_mapa_inverso():
    """Mapeo de CARGA desde la tabla mapeo_novedades: {(novedad_siape_norm, codigo_cie): label}.
    codigo_cie '' = regla general; con CIE = regla para esa enfermedad (gana al cargar)."""
    return MN.cargar_mapa_carga()

# Enfermedades SIN justificar (JUSTIFICADO=NO en SIAPE.xlsx) se cargan con esta
# opción. OJO: "JUSTIFICCIÓN" es la ortografía real del desplegable de la Intranet.
# Motivo con el que el comparador marca el EXAMEN que falta tras un PRE-EXAMEN
# (art. 59 Dec. 4161/96: el examen es el día siguiente al último de pre-examen)
MOTIVO_EXAMEN_AUTO = "EXAMEN_AUTOMATICO_TRAS_PREEXAMEN"

LABEL_ENF_PENDIENTE = "E - LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)"

SIAPE_DIR = r"D:\G\comparacion\SIAPE"

def cargar_justificados():
    """Cruce (dni, NOVEDAD, desde, hasta) -> 'SI'/'NO' leyendo el SIAPE.xlsx original."""
    import glob
    just = {}
    for fp in glob.glob(os.path.join(SIAPE_DIR, "*.xls*")):
        if os.path.basename(fp).startswith("~$"):
            continue
        try:
            df = pd.read_excel(fp)
        except Exception as e:
            print(f"  AVISO: no se pudo leer {fp}: {e}")
            continue
        if "JUSTIFICADO" not in df.columns:
            continue
        for _, r in df.iterrows():
            try:
                dni = int(r["NRO_DOCUMENTO"])
            except Exception:
                continue
            nov   = str(r.get("NOVEDAD", "")).strip().upper()
            desde = fmt_fecha(r.get("FECHA_DESDE"))
            hasta = fmt_fecha(r.get("FECHA_HASTA"))
            if not nov or not desde:
                continue
            just[(dni, nov, desde, hasta)] = str(r.get("JUSTIFICADO", "")).strip().upper()
    return just

TABLA_CARGA = "novedades_carga_intranet"


def crear_tabla_carga(cur):
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLA_CARGA} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          dependencia VARCHAR(20) NOT NULL,
          dni VARCHAR(12) NOT NULL,
          nombre VARCHAR(160) NOT NULL DEFAULT '',
          novedad_siap VARCHAR(160) NOT NULL,
          desde DATE NOT NULL,
          hasta DATE NOT NULL,
          justificado VARCHAR(10) NOT NULL DEFAULT '',
          motivo_comparacion VARCHAR(80) NOT NULL DEFAULT '',
          corrida_id INT UNSIGNED NULL COMMENT 'ultima corrida del comparador 2.0 que la dio pendiente',
          estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE / OK / ERROR / ERROR_NAV / EXCEPCION / SIN_FECHA',
          label_intranet VARCHAR(200) NULL COMMENT 'opcion de la Intranet con la que se cargo/intento',
          detalle VARCHAR(500) NULL,
          intentos INT NOT NULL DEFAULT 0,
          cargado_en DATETIME NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          deps_descartadas VARCHAR(60) NOT NULL DEFAULT '' COMMENT 'dependencias donde la Intranet dijo "no pertenece" (CSV)',
          UNIQUE KEY uq_novedades_carga_intranet (dni, novedad_siap, desde, hasta),
          KEY idx_novedades_carga_intranet__dep (dependencia, estado)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")
    cur.execute("""
        SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = 'deps_descartadas'""",
        (TABLA_CARGA,))
    if not (cur.fetchone() or {}).get("n"):
        cur.execute(f"""
            ALTER TABLE {TABLA_CARGA}
              ADD COLUMN deps_descartadas VARCHAR(60) NOT NULL DEFAULT ''
              COMMENT 'dependencias donde la Intranet dijo "no pertenece" (CSV)'""")


# "No pertenece a su plantel": la fila se prueba en las otras dependencias (como el Art. 26). Cada run
# toma sus filas + las que otra dependencia ya rechazo, salvo las que rechazo el mismo. Si las tres
# la rechazan -> NO_EN_PLANTEL (no se reintenta ni dispara alerta; se repone con Reintentar).
DEPENDENCIAS = ("HOSPITAL", "UPA 4", "UPA 18")
SQL_FILAS_DE_LA_DEP = ("(dependencia = %s OR FIND_IN_SET(dependencia, deps_descartadas))"
                       " AND NOT FIND_IN_SET(%s, deps_descartadas)")


def es_no_pertenece(mensaje):
    return "NO PERTENECE A SU PLANTEL" in _sin_acentos(mensaje)


def anotar_no_pertenece(cur, dni, novedad_siap, desde, hasta, dependencia, label):
    """Suma la dependencia a deps_descartadas: PENDIENTE para las otras o NO_EN_PLANTEL si ya van las 3."""
    cur.execute(f"""
        UPDATE {TABLA_CARGA}
           SET deps_descartadas = IF(FIND_IN_SET(%s, deps_descartadas), deps_descartadas,
                                     IF(deps_descartadas = '', %s, CONCAT(deps_descartadas, ',', %s))),
               label_intranet = %s, intentos = intentos + 1
         WHERE dni = %s AND novedad_siap = %s AND desde = %s AND hasta = %s""",
        (dependencia, dependencia, dependencia, label, dni, novedad_siap, desde, hasta))
    todas = " AND ".join(["FIND_IN_SET(%s, deps_descartadas)"] * len(DEPENDENCIAS))
    cur.execute(f"""
        UPDATE {TABLA_CARGA}
           SET estado = IF({todas}, 'NO_EN_PLANTEL', 'PENDIENTE'),
               detalle = IF({todas}, 'No está en el plantel de HOSPITAL, UPA 4 ni UPA 18',
                            CONCAT('No pertenece al plantel de ', deps_descartadas, ': se prueba en las otras dependencias'))
         WHERE dni = %s AND novedad_siap = %s AND desde = %s AND hasta = %s""",
        (*DEPENDENCIAS, *DEPENDENCIAS, dni, novedad_siap, desde, hasta))


# Novedades SIAPE que NO se cargan en la Intranet a los BECARIOS (ley "Programa ..."; decision del
# usuario 04/10/2026: la anual complementaria da "Opcion no disponible en este plantel"). 18/10/2026:
# solo becas; 10471, residentes y demas SI se cargan (29-COMPLEMENTARIA). Quedan DESCARTADA en la tabla.
NOVEDADES_DESCARTADAS = ("ANUAL COMPLEMENTARIA",)
LEY_BECAS_LIKE = "Programa%"

# Estados de la tabla que los robots NO vuelven a intentar: PERIODO_CERRADO = el Ministerio ya cerro
# el periodo ("fecha de ultimo cierre", no se puede cargar nunca); CAMBIO_SIAPE = alerta del comparador
# (ya no figura en SIAPE; si vuelve a salir pendiente, el INSERT ... ON DUPLICATE la repone a PENDIENTE).
# NO_TRABAJA_DIA: ausente de un franquero en un dia que no esta en su horario ni es feriado
# (lo marca cargar_ausentes_intranet_v2.filtrar_franqueros y lo revisa en cada corrida)
ESTADOS_NO_CARGAR = "('OK', 'DESCARTADA', 'PERIODO_CERRADO', 'CAMBIO_SIAPE', 'NO_EN_PLANTEL', 'NO_TRABAJA_DIA')"


def estado_resultado(r):
    """Estado a guardar en la tabla: el del robot, salvo el rechazo por periodo cerrado."""
    estado = str(r.get("Estado", ""))
    detalle = str(r.get("Detalle") or "")
    if estado.upper() != "OK" and es_error_cierre(detalle) and not detalle.startswith("CONFLICTO"):
        return "PERIODO_CERRADO"
    return estado[:20]


# Estados que todavia se pueden reacomodar al armar la cola (los demas son finales).
ESTADOS_ABIERTOS = "('PENDIENTE', 'ERROR', 'ERROR_NAV')"
DETALLE_MES_CERRADO = "Mes cerrado en el Ministerio"

# FC (franco compensatorio) NO se carga en la Intranet a los agentes ley 10471 Planta/Guardia
# (ley_id 4 y 5; decision del usuario 18/10/2026). Quedan DESCARTADA.
LEY_IDS_SIN_FC = (4, 5)


def marcar_meses_cerrados(cur, corrida, dependencia):
    """Pasa a PERIODO_CERRADO, sin intentarlas, las filas que terminan en un mes ya cerrado.
    El cierre se aprende de los rechazos reales de la Intranet ("fecha de ultimo cierre"):
    el dia mas nuevo rechazado de la dependencia -> se toma cerrado todo ese mes y lo anterior.
    Las que cruzan al mes siguiente no se tocan (el robot las recorta al 1ro del mes abierto).
    Devuelve (fin_del_mes_cerrado, filas_marcadas)."""
    cur.execute(f"""
        SELECT LAST_DAY(MAX(desde)) AS fin
          FROM {TABLA_CARGA}
         WHERE dependencia = %s AND estado = 'PERIODO_CERRADO'
           AND (detalle IS NULL OR detalle NOT LIKE %s)""",
        (dependencia, DETALLE_MES_CERRADO + "%"))
    fin = (cur.fetchone() or {}).get("fin")
    if not fin:
        return None, 0
    n = cur.execute(f"""
        UPDATE {TABLA_CARGA}
           SET estado = 'PERIODO_CERRADO',
               detalle = CONCAT(%s, ' (cerrado hasta ', DATE_FORMAT(%s, '%%d/%%m/%%Y'), '): no se intenta')
         WHERE corrida_id = %s AND dependencia = %s AND estado IN {ESTADOS_ABIERTOS}
           AND hasta <= %s""",
        (DETALLE_MES_CERRADO, fin, corrida, dependencia, fin))
    return fin, n


def descartar_fc_ley_10471(cur, corrida, dependencia):
    """FC de agentes ley 10471 (Planta y Guardia) -> DESCARTADA. Devuelve filas marcadas."""
    return cur.execute(f"""
        UPDATE {TABLA_CARGA} q
           SET q.estado = 'DESCARTADA',
               q.detalle = 'Descartada: FC no se carga en la Intranet a ley 10471 (Planta/Guardia)'
         WHERE q.corrida_id = %s AND q.dependencia = %s AND q.estado IN {ESTADOS_ABIERTOS}
           AND q.novedad_siap LIKE 'FRANCO COMPENSATORIO%%'
           AND EXISTS (SELECT 1 FROM agentes a
                        WHERE a.dni = q.dni AND a.deleted_at IS NULL AND a.estado_empleo <> 'BAJA'
                          AND a.ley_id IN ({",".join(["%s"] * len(LEY_IDS_SIN_FC))}))""",
        (corrida, dependencia, *LEY_IDS_SIN_FC))


def cargar_filas_db(dependencia, test_mode=False):
    """Pendientes de la ULTIMA corrida del Comparador 2.0 para esta dependencia.
    Primero los registra en novedades_carga_intranet (sin pisar las que ya estan OK) y
    despues devuelve las que no estan OK, con la misma forma que las filas del Excel viejo."""
    with MN.conn() as cn, cn.cursor() as cur:
        crear_tabla_carga(cur)
        cur.execute("SELECT MAX(id) AS id FROM comparacion_corridas")
        corrida = (cur.fetchone() or {}).get("id")
        if not corrida:
            return None, []
        cur.execute(f"""
            INSERT INTO {TABLA_CARGA}
              (dependencia, dni, nombre, novedad_siap, desde, hasta, justificado, motivo_comparacion, corrida_id)
            SELECT dependencia, dni, nombre, novedad_siap, desde_siap, hasta_siap, justificado_siap, motivo, corrida_id
              FROM comparacion_novedades
             WHERE corrida_id = %s AND estado = 'SOLO_SIAP' AND motivo <> 'BECARIO_NO_APLICA'
               AND dependencia = %s AND dni <> '' AND desde_siap IS NOT NULL AND hasta_siap IS NOT NULL
               AND novedad_siap <> 'AUSENTE SIN AVISO'   -- los carga cargar_ausentes_intranet_v2.py
            ON DUPLICATE KEY UPDATE
              corrida_id = VALUES(corrida_id), dependencia = VALUES(dependencia), nombre = VALUES(nombre),
              justificado = VALUES(justificado), motivo_comparacion = VALUES(motivo_comparacion),
              estado = IF({TABLA_CARGA}.estado = 'CAMBIO_SIAPE', 'PENDIENTE', {TABLA_CARGA}.estado)""",
            (corrida, dependencia))
        cur.execute(f"""
            UPDATE {TABLA_CARGA} q
               SET q.estado = 'DESCARTADA', q.detalle = 'Descartada: esta novedad no se carga en la Intranet a becarios'
             WHERE q.corrida_id = %s AND q.dependencia = %s AND q.estado IN {ESTADOS_ABIERTOS}
               AND q.novedad_siap IN ({",".join(["%s"] * len(NOVEDADES_DESCARTADAS))})
               AND EXISTS (SELECT 1 FROM agentes a JOIN ley l ON l.id = a.ley_id
                            WHERE a.dni = q.dni AND a.deleted_at IS NULL AND a.estado_empleo <> 'BAJA'
                              AND l.nombre LIKE %s)""",
            (corrida, dependencia, *NOVEDADES_DESCARTADAS, LEY_BECAS_LIKE))
        n_fc = descartar_fc_ley_10471(cur, corrida, dependencia)
        if n_fc:
            print(f"  {n_fc} FC de ley 10471 descartados (no se cargan en la Intranet)")
        fin, n_cerr = marcar_meses_cerrados(cur, corrida, dependencia)
        if n_cerr:
            print(f"  {n_cerr} filas en meses cerrados (hasta {fin:%d/%m/%Y}) -> PERIODO_CERRADO sin intentar")
        cn.commit()
        cur.execute(f"""
            SELECT dependencia, dni, nombre, novedad_siap, desde, hasta, justificado, motivo_comparacion
              FROM {TABLA_CARGA}
             WHERE corrida_id = %s AND {SQL_FILAS_DE_LA_DEP} AND estado NOT IN {ESTADOS_NO_CARGAR}
             ORDER BY nombre, desde""", (corrida, dependencia, dependencia))
        # Las que rechazo otra dependencia se prueban en esta: van con la dependencia del run
        filas = [{
            "Estado": "SOLO_SIAP", "Dependencia": dependencia, "DNI": int(r["dni"]),
            "Nombre": r["nombre"], "Nov. SIAP": r["novedad_siap"],
            "Desde SIAP": r["desde"], "Hasta SIAP": r["hasta"],
            "JUSTIFICADO": r["justificado"], "Motivo": r["motivo_comparacion"],
        } for r in cur.fetchall()]
    if test_mode and filas:
        filas = [f for f in filas if f["DNI"] == filas[0]["DNI"]]
    return corrida, filas

def es_medica_sin_justificar(siap):
    s = str(siap or "").strip().upper()
    return (
        s.startswith("ENFERMEDAD")
        or "ATENCION FAMILIAR ENFERMO" in s
        or "ENFERMEDAD DE FAMILIAR" in s
    )

def agrupar_por_dni(filas, mapa, justificados=None, licencias=None, stats=None):
    grupos = defaultdict(list)
    sin_mapeo = []
    stats = stats if stats is not None else {}
    stats.setdefault("por_cie", [])
    stats.setdefault("medicas_sin_cie", 0)
    for f in filas:
        siap = str(f["Nov. SIAP"]).strip().upper()
        label, cie, por_cie = MN.elegir_label(mapa, licencias, f["DNI"], siap, f["Desde SIAP"], f["Hasta SIAP"])
        if por_cie:
            print(f"    {f['Nombre']}: {siap} CIE {cie} → se carga como {label}")
            stats["por_cie"].append(f"{f['Nombre']} CIE {cie} → {label}")
        elif es_medica_sin_justificar(siap) and not cie:
            stats["medicas_sin_cie"] += 1
        if not label:
            sin_mapeo.append(f"{f['Nombre']} — {siap}")
            continue
        desde = fmt_fecha(f["Desde SIAP"])
        hasta = fmt_fecha(f["Hasta SIAP"])

        # Médicas SIN justificar (JUSTIFICADO=NO) → opción E pendiente.
        # Primero usa la columna del Excel de carga; si no existe, cruza contra el SIAPE original.
        justificado_fila = str(f.get("JUSTIFICADO", f.get("Justificado", ""))).strip().upper()
        if es_medica_sin_justificar(siap):
            try:
                dni_i = int(f["DNI"])
            except Exception:
                dni_i = None
            j = justificado_fila or (justificados.get((dni_i, siap, desde, hasta)) if justificados and dni_i is not None else None)
            if j == "NO":
                label = LABEL_ENF_PENDIENTE
                print(f"    {f['Nombre']}: {siap} sin justificar → se carga como E-PENDIENTE")
                stats["e_pendiente"] = stats.get("e_pendiente", 0) + 1

        grupos[f["DNI"]].append({
            "nombre": f["Nombre"],
            "siap":   str(f["Nov. SIAP"]).strip(),
            "label":  label,
            "desde":  desde,
            "hasta":  hasta,
            # fila EXAMEN que agregó el comparador porque faltaba tras un pre-examen
            "auto":   str(f.get("Motivo", "")).strip() == MOTIVO_EXAMEN_AUTO,
        })
    stats["sin_mapeo"] = len(sin_mapeo)
    if sin_mapeo:
        print(f"  SIN MAPEO ({len(sin_mapeo)} filas):")
        for s in sin_mapeo:
            print(f"    {s}")
    return grupos

# ── Log de resultados ────────────────────────────────────────────────────────

def log_clave(dni, label, desde, hasta):
    return f"{int(dni)}|{label}|{desde}|{hasta}"

def es_anual_o_complementaria(label):
    n = _sin_acentos(label)
    return "DESCANSO ANUAL" in n or "COMPLEMENTARIA" in n

def es_error_cierre(mensaje):
    """"La fecha desde no debe ser menor o igual a la fecha de ultimo cierre": el periodo
    donde arranca la novedad ya esta cerrado en el Ministerio."""
    m = unicodedata.normalize("NFD", str(mensaje or "")).encode("ascii", "ignore").decode().upper()
    return "ULTIMO CIERRE" in m


def primero_mes_siguiente(fecha_ddmmyyyy):
    """'15/07/2026' -> '01/08/2026' (dd/mm/aaaa); None si no parsea."""
    try:
        d = datetime.strptime(str(fecha_ddmmyyyy).strip(), "%d/%m/%Y")
    except Exception:
        return None
    return (datetime(d.year + 1, 1, 1) if d.month == 12 else datetime(d.year, d.month + 1, 1)).strftime("%d/%m/%Y")


def ajuste_maximo_mensual(label, mensaje, desde, hasta):
    """Detecta 'maximo permitido de X dias por mes' y devuelve (X, nuevo_hasta)."""
    if not es_anual_o_complementaria(label):
        return None
    msg = _sin_acentos(mensaje or "")
    m = re.search(r"M.?XIMO PERMITIDO DE\s+(\d+)\s+D.?AS POR MES", msg)
    if not m:
        return None
    max_dias = int(m.group(1))
    if max_dias <= 0:
        return None
    try:
        d_desde = datetime.strptime(str(desde), "%d/%m/%Y")
        d_hasta = datetime.strptime(str(hasta), "%d/%m/%Y")
    except Exception:
        return None
    nuevo_hasta = d_desde + timedelta(days=max_dias - 1)
    if nuevo_hasta >= d_hasta:
        return None
    return max_dias, nuevo_hasta.strftime("%d/%m/%Y")

SCRIPT_ID = None  # lo fija main() segun la dependencia (detalle en script_run_items)
DEPENDENCIA_RUN = None  # lo fija main(): dependencia en la que esta logueado el robot
NOV_SIAP = {}     # (dni, label, desde, hasta) -> novedad SIAPE original (clave de la tabla)
PARTES = {}       # (dni, label, desde, hasta) de un RANGO -> [(desde, hasta), ...] filas de la tabla que junta
_GUARDADOS = {"n": 0}

def _fecha_iso(ddmmyyyy):
    return datetime.strptime(str(ddmmyyyy), "%d/%m/%Y").strftime("%Y-%m-%d")


# ── Rangos: dias seguidos en una sola carga (19/10/2026) ─────────────────────
# El SIAPE trae una fila por dia (FC, ausentes, causas particulares...) y se cargaban de a una.
# Los dias SEGUIDOS del mismo agente con la misma novedad van en UNA carga desde-hasta (7 y 8 ->
# 07 a 08; 7 y 9 -> dos cargas). Puede pasar a los meses siguientes; si el Ministerio rechaza el
# arranque por periodo cerrado se recorta al mes abierto como siempre. Si el rango da otro error
# se reintenta dia por dia. En la tabla sigue una fila por dia: el resultado se anota en cada una.
# No se juntan anual/complementaria (tope de dias por mes) ni el examen automatico.

def juntar_rangos(novs):
    """Junta las novedades de UN agente cuyos dias son seguidos (mismo label y misma novedad
    SIAPE). Cada una sale con "partes": las (desde, hasta) originales que cubre."""
    def clave(nv):
        return (nv.get("label") or "", nv.get("siap") or "", _parse_fecha_ddmmyyyy(nv["desde"]) or date.min)
    out = []
    for nv in sorted(novs, key=clave):
        prev = out[-1] if out else None
        d, h_prev = _parse_fecha_ddmmyyyy(nv["desde"]), prev and _parse_fecha_ddmmyyyy(prev["hasta"])
        if (prev and d and h_prev and d == h_prev + timedelta(days=1)
                and _parse_fecha_ddmmyyyy(nv["hasta"])
                and prev.get("label") == nv.get("label") and prev.get("siap") == nv.get("siap")
                and not nv.get("auto") and not prev.get("auto")
                and not es_anual_o_complementaria(nv.get("label") or "")):
            prev["hasta"] = nv["hasta"]
            prev["partes"].append((nv["desde"], nv["hasta"]))
        else:
            out.append({**nv, "partes": [(nv["desde"], nv["hasta"])]})
    out.sort(key=lambda x: _parse_fecha_ddmmyyyy(x["desde"]) or date.min)
    return out


def partes_a_anotar(r):
    """Filas de la tabla a las que va el resultado `r`: las del rango (con su estado: si se
    recorto por periodo cerrado, las anteriores al recorte quedan PERIODO_CERRADO) o la misma."""
    partes = PARTES.get((int(r["DNI"]), r["Novedad"], r["Desde"], r["Hasta"])) or [(r["Desde"], r["Hasta"])]
    estado, detalle = estado_resultado(r), str(r.get("Detalle") or "")
    if len(partes) == 1:
        return [(partes[0][0], partes[0][1], estado, detalle)]
    rango = f"Cargado en rango {r['Desde']} a {r['Hasta']} ({len(partes)} filas). "
    recorte = _parse_fecha_ddmmyyyy(r.get("RecorteDesde"))
    out = []
    for d, h in partes:
        if estado == "OK" and recorte and _parse_fecha_ddmmyyyy(h) < recorte:
            out.append((d, h, "PERIODO_CERRADO",
                        f"Periodo cerrado en el Ministerio: el rango {r['Desde']} a {r['Hasta']} "
                        f"se cargo desde {r['RecorteDesde']}"))
        else:
            out.append((d, h, estado, rango + detalle))
    return out


def registrar_rangos(grupos):
    """Junta los dias seguidos de cada agente (en el lugar) y deja anotado en NOV_SIAP / PARTES
    a que filas de la tabla va el resultado de cada carga (rango o dia suelto)."""
    for dni_g in grupos:
        grupos[dni_g] = juntar_rangos(grupos[dni_g])
        for nv in grupos[dni_g]:
            k = (int(dni_g), nv["label"], nv["desde"], nv["hasta"])
            NOV_SIAP[k] = nv["siap"]
            for d, h in nv["partes"]:
                NOV_SIAP[(int(dni_g), nv["label"], d, h)] = nv["siap"]
            if len(nv["partes"]) > 1:
                PARTES[k] = nv["partes"]


def guardar_log(registros):
    """2.0: el resultado de cada novedad nueva de `registros` va a novedades_carga_intranet
    (si es un rango, a cada fila que junta)."""
    nuevos = registros[_GUARDADOS["n"]:]
    try:
        with MN.conn() as cn, cn.cursor() as cur:
            for r in nuevos:
                siap = NOV_SIAP.get((int(r["DNI"]), r["Novedad"], r["Desde"], r["Hasta"]))
                if not siap or not r.get("Desde") or not r.get("Hasta"):
                    continue
                for desde, hasta, estado, detalle in partes_a_anotar(r):
                    ok = estado == "OK"
                    clave = (str(int(r["DNI"])), siap, _fecha_iso(desde), _fecha_iso(hasta))
                    if not ok and es_no_pertenece(detalle):
                        anotar_no_pertenece(cur, *clave, DEPENDENCIA_RUN, str(r.get("Novedad") or "")[:200])
                        continue
                    # Si la encontro en este plantel, la fila pasa a ser de esta dependencia
                    cur.execute(f"""
                        UPDATE {TABLA_CARGA}
                           SET estado = %s, label_intranet = %s, detalle = %s, intentos = intentos + 1,
                               cargado_en = IF(%s, NOW(), cargado_en), dependencia = COALESCE(%s, dependencia)
                         WHERE dni = %s AND novedad_siap = %s AND desde = %s AND hasta = %s""",
                        (estado[:20], str(r.get("Novedad") or "")[:200],
                         detalle[:500] or None, ok, DEPENDENCIA_RUN, *clave))
            cn.commit()
        _GUARDADOS["n"] = len(registros)
    except Exception as e:
        print(f"  AVISO: no pude anotar el resultado en {TABLA_CARGA}: {e}")
    if SCRIPT_ID:
        MN.items_desde_registros(SCRIPT_ID, registros)

def es_error_superposicion(mensaje):
    return "SUPERPONE" in _sin_acentos(mensaje or "")

def _parse_fecha_ddmmyyyy(valor):
    try:
        return datetime.strptime(str(valor).strip(), "%d/%m/%Y").date()
    except Exception:
        return None

def _nombre_novedad(label):
    s = str(label or "").strip()
    return s.split(" - ", 1)[1].strip() if " - " in s else s

def leer_historial_novedades(page):
    """Lee la tabla Historial de Novedades visible en /list del agente."""
    try:
        filas = page.evaluate("""() => {
            const out = [];
            const pick = (arr, i) => (i >= 0 && arr[i] ? arr[i] : '').trim();
            for (const table of Array.from(document.querySelectorAll('table'))) {
                const trs = Array.from(table.querySelectorAll('tr'));
                let headers = [];
                let start = -1;
                for (let k = 0; k < trs.length; k++) {
                    const cells = Array.from(trs[k].querySelectorAll('th,td')).map(x => (x.textContent || '').trim().toLowerCase());
                    if (cells.some(h => h.includes('novedad')) && cells.some(h => h.includes('desde')) && cells.some(h => h.includes('hasta'))) {
                        headers = cells;
                        start = k + 1;
                        break;
                    }
                }
                if (start < 0) continue;
                const iNov = headers.findIndex(h => h.includes('novedad'));
                const iDesde = headers.findIndex(h => h.includes('desde'));
                const iHasta = headers.findIndex(h => h.includes('hasta'));
                const iDias = headers.findIndex(h => h.includes('dia') || h.includes('dias'));
                const iMin = headers.findIndex(h => h.includes('min'));
                const iElim = headers.findIndex(h => h.includes('elimin'));
                for (const tr of trs.slice(start)) {
                    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
                    if (!tds.length) continue;
                    const desde = pick(tds, iDesde);
                    const hasta = pick(tds, iHasta);
                    if (!/^\\d{2}\\/\\d{2}\\/\\d{4}$/.test(desde) || !/^\\d{2}\\/\\d{2}\\/\\d{4}$/.test(hasta)) continue;
                    out.push({
                        novedad: pick(tds, iNov),
                        desde,
                        hasta,
                        dias: pick(tds, iDias),
                        min: pick(tds, iMin),
                        eliminado: iElim >= 0 ? pick(tds, iElim) : 'NO',
                    });
                }
            }
            return out;
        }""")
        return filas if isinstance(filas, list) else []
    except Exception:
        return []

def ya_cargada_igual(page, label, desde, hasta):
    """True si el Historial de Novedades del agente (pagina /list, donde queda el robot despues de
    ir_a_novedades) ya tiene la MISMA novedad con las MISMAS fechas y sin eliminar: entonces no se
    vuelve a cargar (la Intranet acepta duplicados y se acumulaban copias). 04/10/2026."""
    intento = _sin_acentos(_nombre_novedad(label))
    if not intento:
        return False
    for row in leer_historial_novedades(page):
        if _sin_acentos(row.get("eliminado") or "NO").startswith("S"):
            continue
        if str(row.get("desde")) != str(desde) or str(row.get("hasta")) != str(hasta):
            continue
        existente = _sin_acentos(row.get("novedad") or "")
        if existente and (intento == existente or intento in existente or existente in intento):
            return True
    return False


def detalle_superposicion(page, label, desde, hasta, mensaje_original, historial_url=None):
    if historial_url:
        try:
            if page.url != historial_url or "Historial de Novedades" not in page.content():
                page.goto(historial_url, wait_until="domcontentloaded", timeout=15000)
                page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

    d1 = _parse_fecha_ddmmyyyy(desde)
    d2 = _parse_fecha_ddmmyyyy(hasta)
    if not d1 or not d2:
        return (mensaje_original or "Existe una novedad o licencia cargada que se superpone con la que intenta ingresar.")[:500]

    intento_norm = _sin_acentos(_nombre_novedad(label))
    coincidencias = []
    historial = leer_historial_novedades(page)
    for row in historial:
        eliminado = _sin_acentos(row.get("eliminado") or "NO")
        if eliminado.startswith("S"):
            continue
        e1 = _parse_fecha_ddmmyyyy(row.get("desde"))
        e2 = _parse_fecha_ddmmyyyy(row.get("hasta"))
        if not e1 or not e2 or d1 > e2 or d2 < e1:
            continue
        existente_norm = _sin_acentos(row.get("novedad") or "")
        misma_novedad = bool(intento_norm and (intento_norm == existente_norm or intento_norm in existente_norm or existente_norm in intento_norm))
        exacta = str(row.get("desde")) == str(desde) and str(row.get("hasta")) == str(hasta)
        coincidencias.append((0 if exacta else 1, 0 if misma_novedad else 1, exacta, misma_novedad, row))

    if not coincidencias:
        base = mensaje_original or "Existe una novedad o licencia cargada que se superpone con la que intenta ingresar."
        return f"{base} | Lei {len(historial)} fila(s) del Historial de Novedades, pero ninguna cruza por fecha con {desde} a {hasta}."

    coincidencias.sort(key=lambda x: (x[0], x[1], x[4].get("desde", ""), x[4].get("novedad", "")))
    exacta = coincidencias[0][2]
    partes = []
    for _, _, _, misma_novedad, row in coincidencias[:3]:
        extra = []
        if row.get("dias"):
            extra.append(f"dias {row.get('dias')}")
        if row.get("min"):
            extra.append(f"min {row.get('min')}")
        extra.append("misma novedad" if misma_novedad else "distinta novedad")
        suf = f" ({', '.join(extra)})" if extra else ""
        partes.append(f"{row.get('novedad')} {row.get('desde')} a {row.get('hasta')}{suf}")
    tipo = "Superposicion exacta" if exacta else "Superposicion no exacta"
    return f"{tipo}: intentaba {label} {desde} a {hasta}; se pisa con {' | '.join(partes)}"

# ── Browser / sesión ─────────────────────────────────────────────────────────

def nueva_pagina(playwright):
    try:
        browser = playwright.chromium.launch_persistent_context(
            CHROME_PROFILE_DIR,
            channel="chrome",
            headless=False,
            slow_mo=150,
            args=["--disable-blink-features=AutomationControlled"],
        )
    except Exception:
        browser = playwright.chromium.launch_persistent_context(
            CHROME_PROFILE_DIR,
            headless=False,
            slow_mo=150,
            args=["--disable-blink-features=AutomationControlled"],
        )
    page = browser.pages[0] if browser.pages else browser.new_page()
    return browser, page

def is_session_expired(page):
    try:
        content = page.content()
        return "acceso denegado" in content.lower() or "no tiene permisos" in content.lower()
    except Exception:
        return False

def error_visible(page):
    """Texto del alert rojo visible en la página (ej: 'no pertenece a su plantel'), o None."""
    try:
        loc = page.locator(".alert-danger").first
        if loc.count() > 0 and loc.is_visible():
            txt = loc.inner_text(timeout=1500).strip().replace("\n", " ")
            txt = txt.lstrip("×x ").strip()
            if txt:
                return txt[:200]
    except Exception:
        pass
    try:
        if "no pertenece a su plantel" in page.content().lower():
            return "El agente buscado no pertenece a su plantel ni presta servicio en su dependencia."
    except Exception:
        pass
    return None

def login_error_text(page):
    for sel in ["#errors", ".error-message-box", ".alert-danger"]:
        try:
            loc = page.locator(sel).first
            if loc.count() > 0 and loc.is_visible():
                txt = loc.inner_text(timeout=1000).strip().replace("\n", " ")
                if txt:
                    return txt[:200]
        except Exception:
            pass
    try:
        content = page.content()
        if "Código de seguridad incorrecto" in content or "Codigo de seguridad incorrecto" in content:
            return "Código de seguridad incorrecto"
    except Exception:
        pass
    return None

def esperar_login_ok(page, timeout_ms=180000):
    deadline = time.time() + (timeout_ms / 1000)
    avisado = False
    ultimo_error = None
    while time.time() < deadline:
        try:
            if "Parte de Novedades" in page.content():
                return
        except Exception:
            pass
        err = login_error_text(page)
        if err and err != ultimo_error:
            print(f"  Login rechazado: {err}")
            ultimo_error = err
        if err and not avisado:
            print("  Dejo la ventana abierta: apretá Iniciar sesión manualmente. Cuando entre, el script sigue solo.")
            avisado = True
        page.wait_for_timeout(2000)
    raise Exception("No se pudo iniciar sesión en Intranet. Revisar contraseña o reCAPTCHA.")

def _sin_acentos(s):
    import unicodedata
    return unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().upper()

def exito_visible(page):
    """Texto del alert verde de éxito visible en la página, o None."""
    try:
        loc = page.locator(".alert-success").first
        if loc.count() > 0 and loc.is_visible():
            txt = loc.inner_text(timeout=1500).strip().replace("\n", " ")
            txt = txt.lstrip("×x ").strip()
            if txt:
                return txt[:200]
    except Exception:
        pass
    return None

MAPA_DEP_CODIGO = {
    "HOSPITAL": "1701",
    "UPA 4":    "1699",
    "UPA 18":   "1826",
}

URLS_LOGOUT = [
    "https://sistemas.ms.gba.gov.ar/partenovedades/web/app.php/logout",
    "https://sistemas.ms.gba.gov.ar/intranet/logout",
]


def cerrar_sesion(page):
    """Con la sesion vieja abierta ("Sesion ya activa") Parte de Novedades entra como PROFERS sin
    dependencia ("Acceso Denegado") y no se puede cambiar de dependencia; con login nuevo anda.
    Por eso el login arranca cerrando la sesion del perfil del robot (09/10/2026)."""
    for url in URLS_LOGOUT:
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1500)
        except Exception as e:
            print(f"  AVISO logout {url}: {e}")


def login(page, password, dependencia="HOSPITAL"):
    cerrar_sesion(page)
    page.goto(URL_LOGIN, wait_until="domcontentloaded", timeout=30000)
    try:
        page.wait_for_selector("#username", timeout=6000)
        page.fill("#username", USUARIO)
        page.fill("#password", password)
        page.wait_for_timeout(500)
        page.click("form button[type=submit]")
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        esperar_login_ok(page)
    except Exception:
        # No apareció el form de login → la sesión sigue viva (login.php redirige)
        print("  Sesión ya activa, no hace falta re-login")
    page.wait_for_selector("text=Parte de Novedades", timeout=180000)
    page.click("text=Parte de Novedades")
    page.wait_for_load_state("networkidle", timeout=20000)

    # Cambiar a la dependencia destino (UPA 4, UPA 18, HOSPITAL)
    cambiar_dependencia(page, dependencia)

def cambiar_dependencia(page, dependencia):
    """Cambia la dependencia de la sesión (perfil multidependencia).
    Opera el modal 'Cambiar Dependencia' DIRECTO por JS (sirve visible u oculto)
    y verifica contra el chip del header 'xxxxxxx (codigo)'.
    Si el cambio no se confirma, ABORTA (para no cargar en la dependencia equivocada).
    """
    codigo = MAPA_DEP_CODIGO.get(dependencia.upper(), "1701")

    # ¿Ya estamos en la dependencia pedida? El header muestra "xxxxxxx (1701)"
    try:
        if f"({codigo})" in page.content():
            print(f"  Ya en dependencia {dependencia} ({codigo})")
            return
    except Exception:
        pass

    # Intento UI (best-effort): abrir menú de usuario y click en "Cambiar dependencia"
    try:
        for sel in [f"a.dropdown-toggle:has-text('{USUARIO}')",
                    f".dropdown-toggle:has-text('{USUARIO}')",
                    f"a:has-text('{USUARIO}')"]:
            try:
                loc = page.locator(sel).first
                if loc.count() > 0:
                    loc.click(timeout=2000)
                    break
            except Exception:
                continue
        page.wait_for_timeout(300)
        item = page.locator("a:has-text('Cambiar dependencia'), button:has-text('Cambiar dependencia')").first
        try:
            item.click(timeout=2000)
        except Exception:
            try:
                item.click(force=True)
            except Exception:
                pass
        page.wait_for_timeout(600)
    except Exception:
        pass

    # Operar el modal por JS: setear el select y clickear "Cambiar".
    # No depende de visibilidad — el modal existe en el DOM (#myModalLabel).
    try:
        resultado = page.evaluate("""(codigo) => {
            const h4 = document.querySelector('#myModalLabel');
            const scope = (h4 && h4.closest('.modal')) || document;
            const sel = scope.querySelector('select');
            if (!sel) return 'SIN_SELECT';
            let ok = false;
            for (const opt of Array.from(sel.options)) {
                const t = (opt.text || '').trim();
                if (t.startsWith(codigo + ' ') || t.startsWith(codigo + '-') || opt.value === codigo) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    ok = true;
                    break;
                }
            }
            if (!ok) return 'SIN_OPCION';
            const btns = Array.from(scope.querySelectorAll("button, input[type=submit], input[type=button]"));
            const btn = btns.find(b => ((b.innerText || b.value || '').trim().toLowerCase() === 'cambiar'));
            if (!btn) return 'SIN_BOTON';
            btn.click();
            return 'OK';
        }""", codigo)
        if resultado != 'OK':
            print(f"  ADVERTENCIA modal dependencia: {resultado}")
    except Exception as e:
        # Si el click navegó y destruyó el contexto JS, no es error: pasamos a verificar
        if "context" not in str(e).lower():
            print(f"  ADVERTENCIA al operar el modal: {e}")

    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(800)

    # Verificación DURA contra el header; un reload por si quedó cacheado
    for _ in range(2):
        try:
            if f"({codigo})" in page.content():
                print(f"  Dependencia cambiada a {dependencia} ({codigo})")
                return
        except Exception:
            pass
        try:
            page.reload(wait_until="networkidle", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(500)

    raise Exception(f"NO se pudo cambiar la dependencia a {dependencia} ({codigo}) — se aborta para no cargar en la dependencia equivocada")

def ir_a_novedades(page, dni, password, dependencia="HOSPITAL", nombre=None):
    """Navega a /list del agente. Re-hace login si la sesión expiró."""
    for intento in range(2):
        try:
            page.goto(URL_PLANTEL, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_selector("input:not([type=hidden])", timeout=10000)

            if is_session_expired(page):
                raise Exception("sesion_expirada")

            page.wait_for_timeout(400)
            # Campo N° Documento: identificado por name/id ('documento'/'dni') o por su label —
            # nunca posicional
            info_dni = page.evaluate("""() => {
                const usable = Array.from(document.querySelectorAll('input')).filter(i =>
                    !['hidden','submit','button','checkbox','radio'].includes((i.type || '').toLowerCase()));
                const clave = i => ((i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '')).toLowerCase();
                let el = usable.find(i => clave(i).includes('documento') || clave(i).includes('dni'));
                if (!el) {
                    for (const lb of Array.from(document.querySelectorAll('label'))) {
                        if ((lb.textContent || '').toLowerCase().includes('documento')) {
                            const forId = lb.getAttribute('for');
                            el = (forId && document.getElementById(forId)) ||
                                 (lb.parentElement && lb.parentElement.querySelector('input'));
                            if (el) break;
                        }
                    }
                }
                if (!el) return null;
                document.querySelectorAll('[data-pw-dni]').forEach(e => e.removeAttribute('data-pw-dni'));
                el.setAttribute('data-pw-dni', '1');
                return { name: el.name || '', id: el.id || '' };
            }""")
            if not info_dni:
                return False, "No se encontró el campo N° Documento en Buscar Personal"
            if not getattr(ir_a_novedades, "_dni_impreso", False):
                print(f"  Campo DNI identificado: {info_dni}")
                ir_a_novedades._dni_impreso = True
            campo_dni = page.locator("[data-pw-dni='1']")
            campo_dni.click()
            campo_dni.fill(str(int(dni)))
            page.get_by_role("button", name="Buscar").click()
            page.wait_for_load_state("networkidle", timeout=15000)

            # Capturar el error que muestra la página (ej: "no pertenece a su plantel")
            msg_pag = error_visible(page)
            if msg_pag:
                return False, msg_pag

            page.wait_for_selector("table tbody tr", timeout=10000)

            res_js = page.evaluate("""() => {
                // Ubicar la tabla del plantel por su FILA DE ENCABEZADO (Parte + Fecha baja).
                // OJO: los encabezados NO están en <thead> en esta página — se busca la
                // fila de títulos dentro de cada tabla y los datos son las filas siguientes.
                let cols = [], rows = [];
                for (const t of Array.from(document.querySelectorAll('table'))) {
                    const filas = Array.from(t.querySelectorAll('tr'));
                    for (let k = 0; k < filas.length; k++) {
                        const cells = Array.from(filas[k].querySelectorAll('th,td')).map(x => (x.textContent || '').trim().toLowerCase());
                        if (cells.length >= 4 && cells.some(c => c.includes('parte')) && cells.some(c => c.includes('baja'))) {
                            cols = cells;
                            rows = filas.slice(k + 1).filter(r => r.querySelectorAll('td').length >= 3);
                            break;
                        }
                    }
                    // sin break externo: si hay tablas anidadas, la más interna pisa a la envolvente
                }
                if (!cols.length) return { error: 'No se encontró la tabla del plantel' };
                if (rows.length === 0) return { error: 'Sin filas en el plantel' };
                const idxParte = cols.findIndex(c => c.includes('parte'));
                const idxBaja  = cols.findIndex(c => c.includes('baja'));
                const idxNom   = cols.findIndex(c => c.includes('apellido'));
                const celda = (tr, i) => { const t = tr.querySelectorAll('td'); return (i >= 0 && t[i]) ? (t[i].textContent || '').trim() : ''; };

                // SOLO activas (sin fecha de baja) y NUNCA HORAS CATEDRA
                const activos = rows.filter(tr => {
                    const baja = celda(tr, idxBaja);
                    const activa = baja === '' || baja.includes('0---');
                    return activa && !celda(tr, idxParte).toUpperCase().includes('HORAS CATEDRA');
                });
                if (activos.length === 0) return { error: 'Sin fila válida: todas con baja o HORAS CATEDRA' };

                // Prioridad de parte: PLANTA > BECAS > otras (a igual prioridad, la última)
                const score = tr => {
                    const p = celda(tr, idxParte).toUpperCase();
                    if (p.includes('PLANTA')) return 3;
                    if (p.includes('BECA')) return 2;
                    return 1;
                };
                let fila = activos[0];
                for (const tr of activos) { if (score(tr) >= score(fila)) fila = tr; }
                for (const a of fila.querySelectorAll('.dropdown-menu a')) {
                    if (a.textContent.trim() === 'Novedades') {
                        return { href: a.getAttribute('href'), parte: celda(fila, idxParte), nombre: celda(fila, idxNom) };
                    }
                }
                return { error: 'La fila elegida no tiene link Novedades' };
            }""")

            href = res_js.get('href') if isinstance(res_js, dict) else None
            if not href:
                motivo = res_js.get('error') if isinstance(res_js, dict) else None
                return False, motivo or "No se encontró link Novedades"
            print(f"  Fila plantel elegida: {res_js.get('nombre','?')} | {res_js.get('parte','?')}")

            page.goto(f"{BASE_URL}{href}", wait_until="domcontentloaded", timeout=15000)
            page.wait_for_load_state("networkidle", timeout=15000)
            return True, None

        except Exception as e:
            msg = str(e)
            # Si la página muestra un error concreto, reportar ESE (no el timeout de Playwright)
            msg_pag = error_visible(page)
            if msg_pag:
                return False, msg_pag
            if "sesion_expirada" in msg or "acceso denegado" in msg.lower() or intento == 0:
                if intento == 0:
                    print("  Sesión expirada, re-login...")
                    try:
                        login(page, password, dependencia)
                        continue
                    except Exception as le:
                        return False, f"Re-login falló: {le}"
            return False, msg

    return False, "No se pudo navegar tras re-login"

def cargar_novedad(page, label, desde, hasta):
    """Selecciona novedad, fecha y guarda. Retorna (exito, mensaje)."""
    try:
        # Select de la novedad: primero por id/name del form Symfony (personalnovedadtype);
        # recién si no está, por el texto "Seleccione"
        select_nov = page.locator("select[id*='personalnovedadtype'], select[name*='personalnovedadtype']").first
        try:
            select_nov.wait_for(timeout=4000)
        except Exception:
            select_nov = page.locator("select").filter(has_text="Seleccione").first
            select_nov.wait_for(timeout=6000)
        try:
            info_sel = select_nov.evaluate("el => ({ name: el.name || '', id: el.id || '' })")
            if not getattr(cargar_novedad, "_sel_impreso", False):
                print(f"  Select novedad identificado: {info_sel}")
                cargar_novedad._sel_impreso = True
        except Exception:
            pass

        # Buscar la opción real del desplegable (insensible a acentos/mayúsculas)
        opciones = select_nov.evaluate("el => Array.from(el.options).map(o => o.text.trim())")
        label_n = _sin_acentos(label).strip()
        real = next((op for op in opciones if _sin_acentos(op).strip() == label_n), None)
        if real is None:
            real = next((op for op in opciones if label_n and label_n in _sin_acentos(op)), None)
        if real is None:
            return False, "Opción no disponible en este plantel"

        select_nov.select_option(label=real)
        page.wait_for_timeout(400)
        page.get_by_role("button", name="Continuar").click()
        page.wait_for_load_state("networkidle", timeout=15000)

    except Exception as e:
        msg_pag = error_visible(page)   # capturar ANTES de go_back
        # Intentar navegar de vuelta a /list para el próximo intento
        try:
            page.go_back()
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        return False, msg_pag or f"Error al seleccionar: {e}"

    # Completar fechas — campos EXACTOS del formulario de la novedad (Symfony).
    # Los del filtro del historial tienen otros nombres: imposible confundirse.
    try:
        SEL_DESDE = "#minsaludba_partenovedadesbundle_personalnovedadtype_fechaDesde"
        SEL_HASTA = "#minsaludba_partenovedadesbundle_personalnovedadtype_fechaHasta"
        try:
            page.wait_for_selector(SEL_DESDE, state="attached", timeout=8000)
        except Exception:
            msg_pag = error_visible(page)
            try:
                page.go_back()
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            return False, msg_pag or "No apareció el formulario de fechas — no se cargó"

        campo_desde = page.locator(SEL_DESDE)
        campo_hasta = page.locator(SEL_HASTA)
        campo_desde.click()
        campo_desde.press_sequentially(desde, delay=80)
        page.wait_for_timeout(300)
        campo_hasta.click()
        campo_hasta.press_sequentially(hasta, delay=80)
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Guardar").click()
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception as e:
        return False, f"Error al guardar: {e}"

    # ¿Éxito? Capturar el cartel verde textual (queda como constancia en el log)
    ok_msg = exito_visible(page)
    if ok_msg:
        return True, ok_msg
    if "correctamente" in page.content().lower():
        return True, "Guardado correctamente (confirmación detectada en la página)"

    # Extraer mensaje de error
    try:
        msg = page.locator(".alert, .error, .alert-danger, [class*='error'], [class*='alert']").first.inner_text(timeout=2000)
        msg = msg.strip().replace("\n", " ")[:200]
    except Exception:
        msg = "sin confirmación (sin mensaje de error capturado)"

    # Volver a /list para el próximo intento dentro del mismo agente
    try:
        page.go_back()
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass

    return False, msg

# ── Main ─────────────────────────────────────────────────────────────────────

def dep_de_fila(fila):
    """Normaliza la columna Dependencia de una fila a HOSPITAL / UPA 4 / UPA 18."""
    dep = str(fila.get("Dependencia", "")).strip().upper()
    if "UPA" in dep and "18" in dep:
        return "UPA 18"
    if "UPA" in dep and "4" in dep:
        return "UPA 4"
    return "HOSPITAL"

def detectar_dependencia(filas):
    """Dependencia de la primera fila con dato (fallback si no viene --dependencia)."""
    for fila in filas:
        if str(fila.get("Dependencia", "")).strip():
            return dep_de_fila(fila)
    return "HOSPITAL"

def resumen_run(ok, err, stats):
    """Texto para la pagina Robots SIAPE (columna Detalle)."""
    partes = [f"{ok} cargadas OK", f"{err} con error"]
    por_cie = stats.get("por_cie") or []
    partes.append(f"{len(por_cie)} enfermedades cargadas por CIE")
    if stats.get("examen_auto_ok"):
        partes.append(f"{stats['examen_auto_ok']} exámenes automáticos tras pre-examen")
    if stats.get("e_pendiente"):
        partes.append(f"{stats['e_pendiente']} como E-pendiente (sin justificar)")
    if stats.get("medicas_sin_cie"):
        partes.append(f"{stats['medicas_sin_cie']} médicas sin licencia/CIE (regla general)")
    if stats.get("sin_mapeo"):
        partes.append(f"{stats['sin_mapeo']} sin mapeo")
    txt = " · ".join(partes)
    if por_cie:
        txt += " | " + "; ".join(por_cie)
    return txt

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--pass", dest="password")
    parser.add_argument("--dependencia", dest="dependencia", default="HOSPITAL",
                        help="HOSPITAL / UPA 4 / UPA 18")
    parser.add_argument("--solo-cola", action="store_true",
                        help="arma y lista los pendientes desde la base, sin abrir la Intranet")
    args = parser.parse_args()

    password   = args.password or os.environ.get("INTRANET_PASS") or input("Contraseña: ")

    t0 = time.time()
    mapa   = build_mapa_inverso()
    licencias = MN.cargar_licencias()
    print(f"Mapeo (tabla mapeo_novedades): {len(mapa)} reglas de carga, "
          f"{sum(1 for (_n, c) in mapa if c)} por CIE · licencias con CIE: {len(licencias)} agentes")
    dependencia = args.dependencia.upper().strip()
    if dependencia not in MAPA_DEP_CODIGO:
        print(f"ERROR: dependencia invalida '{args.dependencia}' (HOSPITAL / UPA 4 / UPA 18)")
        return
    script_id = f"intranet_carga_novedades_v2_{MN.sufijo_dep(dependencia)}"
    script_desc = f"Carga de novedades 2.0 en Intranet MS ({dependencia})"
    corrida, filas = cargar_filas_db(dependencia, test_mode=args.test)
    if corrida is None:
        print("No hay corridas del Comparador 2.0 todavia.")
        MN.registrar_run(script_id, script_desc, "error", motivo="No hay corridas del Comparador 2.0",
                         duracion_seg=int(time.time() - t0))
        return
    print(f"Comparador 2.0 corrida {corrida}: {len(filas)} novedad(es) pendiente(s) para {dependencia}")
    if args.solo_cola:
        for f in filas:
            print(f"  {f['DNI']}  {f['Nombre']}  {f['Nov. SIAP']}  {f['Desde SIAP']} -> {f['Hasta SIAP']}"
                  f"  {('[' + f['Motivo'] + ']') if f['Motivo'] != 'EN_SIAP_SIN_MINISTERIO' else ''}")
        grupos = agrupar_por_dni(filas, mapa, None, licencias)
        registrar_rangos(grupos)
        print(f"\nCargas a hacer (dias seguidos juntos): {sum(len(v) for v in grupos.values())}")
        for dni_g, novs in grupos.items():
            for nv in novs:
                if len(nv["partes"]) > 1:
                    print(f"  {dni_g}  {nv['nombre']}  {nv['label']}  {nv['desde']} -> {nv['hasta']}"
                          f"  ({len(nv['partes'])} filas)")
        return
    if not filas:
        print("Nada pendiente.")
        MN.registrar_run(script_id, script_desc, "ok", motivo=f"Sin pendientes (corrida {corrida})",
                         filas=0, duracion_seg=int(time.time() - t0))
        return
    justificados = cargar_justificados()
    if justificados:
        print(f"Cruce JUSTIFICADO: {len(justificados)} filas leídas de SIAPE.xlsx")
    else:
        print("AVISO: sin cruce JUSTIFICADO (no se pudo leer SIAPE.xlsx) — todo se carga con el mapeo normal")
    print(f"Dependencia del run: {dependencia}")

    # SOLO filas de esta dependencia — nunca mezclar (evita 'no pertenece a su plantel')
    antes = len(filas)
    filas = [f for f in filas if dep_de_fila(f) == dependencia]
    if antes - len(filas):
        print(f"OJO: {antes - len(filas)} filas de OTRA dependencia quedaron AFUERA de este run")
    if not filas:
        print("No quedan filas para esta dependencia.")
        return

    stats = {}
    grupos = agrupar_por_dni(filas, mapa, justificados, licencias, stats)
    n_filas = sum(len(v) for v in grupos.values())
    registrar_rangos(grupos)
    print(f"Rangos: {n_filas} filas -> {sum(len(v) for v in grupos.values())} cargas (dias seguidos juntos)")

    ya_ok, registros = set(), []   # 2.0: las OK ya quedaron afuera en cargar_filas_db
    global SCRIPT_ID, DEPENDENCIA_RUN
    DEPENDENCIA_RUN = dependencia
    SCRIPT_ID = script_id
    MN.items_desde_registros(script_id, registros, inicio=len(registros))
    if ya_ok:
        print(f"Log existente: {len(ya_ok)} novedades ya cargadas (se saltean)")

    print(f"Agentes a procesar: {len(grupos)}")

    ok_count = sum(1 for r in registros if r.get("Estado") == "OK")
    err_count = sum(1 for r in registros if r.get("Estado") != "OK")
    ok_inicio, err_inicio = ok_count, err_count

    with sync_playwright() as p:
        browser, page = nueva_pagina(p)

        print("Iniciando sesión...")
        try:
            login(page, password, dependencia)
        except Exception as e:
            print(f"ERROR en login: {e}")
            browser.close()
            MN.registrar_run(script_id, script_desc, "error", motivo=f"Login: {e}",
                             archivo=TABLA_CARGA, duracion_seg=int(time.time() - t0))
            return
        print("Sesión iniciada.\n")

        for i, (dni, novedades) in enumerate(grupos.items(), 1):
            nombre = novedades[0]["nombre"]

            # Saltar si todas las novedades de este agente ya están OK
            pendientes = [
                nov for nov in novedades
                if log_clave(dni, nov["label"], nov["desde"], nov["hasta"]) not in ya_ok
            ]
            if not pendientes:
                print(f"[{i}/{len(grupos)}] {nombre} — ya cargado, se salta")
                continue

            print(f"[{i}/{len(grupos)}] {nombre} (DNI {int(dni)}) — {len(pendientes)} pendiente(s)")

            # Re-abrir browser si se cerró
            try:
                page.title()
            except Exception:
                print("  Browser cerrado, reabriendo...")
                try:
                    browser.close()
                except Exception:
                    pass
                browser, page = nueva_pagina(p)
                try:
                    login(page, password, dependencia)
                    print("  Re-login OK")
                except Exception as e:
                    print(f"  Re-login falló: {e}")
                    break

            try:
                exito_nav, msg_nav = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                if not exito_nav:
                    for nov in pendientes:
                        registros.append({
                            "Nombre": nombre, "DNI": int(dni),
                            "Novedad": nov["label"],
                            "Desde": nov["desde"], "Hasta": nov["hasta"],
                            "Estado": "ERROR_NAV", "Detalle": msg_nav
                        })
                        err_count += 1
                    guardar_log(registros)
                    continue

                cola = list(pendientes)
                while cola:
                    nov = cola.pop(0)
                    recorte_desde = None   # si el rango se recorto por periodo cerrado: desde donde se cargo
                    if not nov["desde"] or not nov["hasta"]:
                        print(f"  SKIP {nov['label']}: fechas vacías")
                        registros.append({
                            "Nombre": nombre, "DNI": int(dni),
                            "Novedad": nov["label"],
                            "Desde": nov["desde"], "Hasta": nov["hasta"],
                            "Estado": "SIN_FECHA", "Detalle": ""
                        })
                        err_count += 1
                        guardar_log(registros)
                        continue

                    print(f"  Cargando: {nov['label']} {nov['desde']} → {nov['hasta']}")

                    # Re-abrir browser si se cerró durante la carga
                    try:
                        page.title()
                    except Exception:
                        print("  Browser cerrado a mitad, reabriendo y renavegando...")
                        try:
                            browser.close()
                        except Exception:
                            pass
                        browser, page = nueva_pagina(p)
                        try:
                            login(page, password, dependencia)
                            exito_nav2, _ = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                            if not exito_nav2:
                                raise Exception("No se pudo renavegar")
                        except Exception as e:
                            print(f"  Recuperación falló: {e}")
                            registros.append({
                                "Nombre": nombre, "DNI": int(dni),
                                "Novedad": nov["label"],
                                "Desde": nov["desde"], "Hasta": nov["hasta"],
                                "Estado": "ERROR", "Detalle": "Browser cerrado, recuperación falló"
                            })
                            err_count += 1
                            guardar_log(registros)
                            continue

                    try:
                        historial_url = page.url
                        if ya_cargada_igual(page, nov["label"], nov["desde"], nov["hasta"]):
                            exito, msg_err = True, ("YA ESTABA CARGADA: la misma novedad con las mismas fechas ya "
                                                    "figura en el historial del agente (no se duplica)")
                        else:
                            exito, msg_err = cargar_novedad(page, nov["label"], nov["desde"], nov["hasta"])
                        if exito:
                            print(f"  OK — {msg_err}" if msg_err else "  OK")
                            ok_count += 1
                            ya_ok.add(log_clave(dni, nov["label"], nov["desde"], nov["hasta"]))
                            estado, detalle = "OK", msg_err or ""
                            if nov.get("auto"):
                                stats["examen_auto_ok"] = stats.get("examen_auto_ok", 0) + 1
                                detalle = ("Examen automático tras pre-examen. " + detalle).strip()
                        else:
                            if es_error_superposicion(msg_err):
                                msg_err = detalle_superposicion(page, nov["label"], nov["desde"], nov["hasta"], msg_err, historial_url)
                            ajuste = None if es_error_cierre(msg_err) else                                 ajuste_maximo_mensual(nov["label"], msg_err, nov["desde"], nov["hasta"])
                            if es_error_cierre(msg_err):
                                # Periodo cerrado en el Ministerio: se carga solo la parte abierta,
                                # corriendo el "desde" al 1 del mes siguiente (hasta 6 meses, sin pasar
                                # el "hasta"). Si el recorte da OTRO error (superpone / ya posee / tope) es
                                # un CONFLICTO con lo que tiene el Ministerio: queda como error para revisar
                                # (al principio se tomaba como "ya estaba cargada", pero la verificacion del
                                # 04/10/2026 mostro que no lo estaba).
                                hasta_dt = datetime.strptime(nov["hasta"], "%d/%m/%Y")
                                desde_rec = nov["desde"]
                                estado, detalle = "ERROR", f"{msg_err} | todo el periodo esta cerrado"
                                for _ in range(6):
                                    desde_rec = primero_mes_siguiente(desde_rec)
                                    if not desde_rec or datetime.strptime(desde_rec, "%d/%m/%Y") > hasta_dt:
                                        break
                                    print(f"  Periodo cerrado: reintento desde {desde_rec} -> {nov['hasta']}")
                                    exito_nav2, msg_nav2 = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                                    if not exito_nav2:
                                        estado, detalle = "ERROR", f"{msg_err} | No se pudo volver para recortar: {msg_nav2}"
                                        break
                                    exito2, msg2 = cargar_novedad(page, nov["label"], desde_rec, nov["hasta"])
                                    if exito2:
                                        estado, recorte_desde = "OK", desde_rec
                                        detalle = (f"OK RECORTADO: periodo anterior cerrado en el Ministerio. "
                                                   f"Original {nov['desde']} a {nov['hasta']}; "
                                                   f"cargado {desde_rec} a {nov['hasta']}. {msg2 or ''}").strip()
                                        break
                                    if es_error_cierre(msg2):
                                        continue                     # tambien cerrado: un mes mas
                                    estado = "ERROR"
                                    detalle = (f"CONFLICTO con el Ministerio: periodo anterior cerrado y el recorte "
                                               f"desde {desde_rec} dio: {msg2 or 'error'}")[:500]
                                    break
                                if estado == "OK":
                                    print(f"  {detalle[:120]}")
                                    ok_count += 1
                                    ya_ok.add(log_clave(dni, nov["label"], nov["desde"], nov["hasta"]))
                                else:
                                    print(f"  ERROR: {detalle[:120]}")
                                    err_count += 1
                            elif ajuste:
                                max_dias, hasta_ajustado = ajuste
                                print(f"  Ajuste por maximo mensual: reintento {nov['desde']} -> {hasta_ajustado} ({max_dias} dias)")
                                exito_nav2, msg_nav2 = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                                if exito_nav2:
                                    exito2, msg2 = cargar_novedad(page, nov["label"], nov["desde"], hasta_ajustado)
                                else:
                                    exito2, msg2 = False, f"No se pudo volver para ajuste: {msg_nav2}"
                                if exito2:
                                    print(f"  OK AJUSTADO - {msg2}" if msg2 else "  OK AJUSTADO")
                                    ok_count += 1
                                    ya_ok.add(log_clave(dni, nov["label"], nov["desde"], nov["hasta"]))
                                    estado = "OK"
                                    detalle = (f"OK AJUSTADO: maximo {max_dias} dias por mes. "
                                               f"Original {nov['desde']} a {nov['hasta']}; "
                                               f"cargado {nov['desde']} a {hasta_ajustado}. {msg2 or ''}").strip()
                                else:
                                    print(f"  ERROR AJUSTE: {msg2}")
                                    err_count += 1
                                    estado = "ERROR"
                                    detalle = f"{msg_err or ''} | Ajuste {nov['desde']} a {hasta_ajustado} fallo: {msg2 or ''}"[:200]
                            else:
                                print(f"  ERROR: {msg_err}")
                                err_count += 1
                                estado, detalle = "ERROR", msg_err or ""
                    except Exception as e:
                        print(f"  EXCEPCIÓN: {e}")
                        err_count += 1
                        estado, detalle = "EXCEPCION", str(e)[:200]

                    # Rango con error (que no sea periodo cerrado ni "no pertenece"): dia por dia,
                    # asi un dia en conflicto no frena a los demas.
                    if (estado != "OK" and len(nov.get("partes") or []) > 1
                            and estado_resultado({"Estado": estado, "Detalle": detalle}) != "PERIODO_CERRADO"
                            and not es_no_pertenece(detalle)):
                        print(f"  El rango dio error: reintento dia por dia ({len(nov['partes'])} filas)")
                        err_count -= 1
                        cola[0:0] = [{**nov, "desde": d, "hasta": h, "partes": [(d, h)]} for d, h in nov["partes"]]
                        try:
                            ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                        except Exception:
                            pass
                        continue

                    registros.append({
                        "Nombre": nombre, "DNI": int(dni),
                        "Novedad": nov["label"],
                        "Desde": nov["desde"], "Hasta": nov["hasta"],
                        "Estado": estado, "Detalle": detalle,
                        "RecorteDesde": recorte_desde,
                    })
                    guardar_log(registros)

            except Exception as e:
                print(f"  EXCEPCIÓN GENERAL: {e}")
                for nov in pendientes:
                    registros.append({
                        "Nombre": nombre, "DNI": int(dni),
                        "Novedad": nov["label"],
                        "Desde": nov["desde"], "Hasta": nov["hasta"],
                        "Estado": "EXCEPCION", "Detalle": str(e)[:200]
                    })
                    err_count += 1
                guardar_log(registros)

        print(f"\nResultado total: {ok_count} OK, {err_count} errores.")
        print(f"Resultado anotado en la tabla {TABLA_CARGA}")
        MN.registrar_run(script_id, script_desc, "ok",
                         motivo=f"Corrida {corrida}: " + resumen_run(ok_count - ok_inicio, err_count - err_inicio, stats),
                         filas=ok_count - ok_inicio, archivo=TABLA_CARGA,
                         duracion_seg=int(time.time() - t0))
        try:
            browser.close()
        except Exception:
            pass

    # navegador ya cerrado: archivo del Ministerio nuevo + comparacion contra SIAPE
    post_carga.actualizar_ministerio_y_comparar(dependencia, ok_count - ok_inicio)

if __name__ == "__main__":
    main()
