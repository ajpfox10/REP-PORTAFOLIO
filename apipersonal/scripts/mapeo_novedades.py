"""
Mapeo UNICO novedad SIAPE -> novedad Ministerio, leido de la tabla
`mapeo_novedades` (migracion 055). Reemplaza al viejo
apifront/mapeo.asistencia.json que leian los robots de carga en la Intranet.

Regla del CIE: si la enfermedad tiene licencia en LICENCIAS_MEDICAS.xlsx
(export SIAPE "Licencias Médicas") y su CODIGO_OMS tiene fila propia en la
tabla, se carga con ESA novedad (ej. ciertos CIE -> 1R-ENFERMEDAD DE RIESGO).
Si no, la fila general (codigo_cie = '').

Tambien registra el resumen de cada corrida en `script_runs` para la pagina
Herramientas -> Robots SIAPE.
"""
import os
import unicodedata
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import pymysql

LICENCIAS_PATH = r"D:\G\comparacion\LICENCIAS_MEDICAS.xlsx"
CIE_RELLENO = {"66666666"}  # lo usa SIAPE en maternidad/nacimiento: no es un CIE real


def _load_dotenv():
    """Carga el .env de apipersonal sin pisar variables heredadas (mismo criterio
    que cargar_francos_siape.py)."""
    for fp in (Path(__file__).resolve().parents[1] / ".env", Path.cwd() / ".env"):
        if not fp.exists():
            continue
        try:
            for raw in fp.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key and os.environ.get(key, "") == "":
                    os.environ[key] = value.strip().strip('"').strip("'")
        except Exception as e:
            print(f"AVISO: no se pudo leer {fp}: {e}")


_load_dotenv()

# Identificador de ESTA corrida: une la fila de script_runs con su detalle en
# script_run_items. Si lo lanzo run_robot.py viene en ROBOT_RUN_UID (asi el
# robot hijo y el lanzador comparten corrida); si no, se crea uno.
RUN_UID = os.environ.get("ROBOT_RUN_UID") or uuid.uuid4().hex
os.environ["ROBOT_RUN_UID"] = RUN_UID

_ESTADOS_OK = {"ok", "cargado", "corregido", "cargada"}
_ESTADOS_ERROR = {"error", "excepcion", "error_nav", "fallo"}


def registrar_item(script, dni=None, nombre=None, novedad=None, desde=None, hasta=None,
                   estado="ok", detalle=None):
    """Una fila de detalle (agente/novedad) de la corrida en curso. Nunca corta
    al robot: si la base falla, avisa y sigue."""
    e = str(estado or "").strip().lower()
    e = "ok" if e in _ESTADOS_OK else "error" if e in _ESTADOS_ERROR or e.startswith("error") else "aviso"
    try:
        with conn() as cn, cn.cursor() as cur:
            cur.execute(
                "INSERT INTO script_run_items (run_uid, script, dni, nombre, novedad, desde, hasta, estado, detalle) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (RUN_UID, script, str(dni)[:20] if dni is not None else None,
                 (str(nombre) if nombre else None) and str(nombre)[:200],
                 (str(novedad) if novedad else None) and str(novedad)[:200],
                 str(desde)[:20] if desde else None, str(hasta)[:20] if hasta else None,
                 e, (str(detalle) if detalle else None) and str(detalle)[:1000]),
            )
            cn.commit()
    except Exception as ex:
        print(f"AVISO: no pude registrar el detalle en script_run_items: {ex}")


def conn():
    return pymysql.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", 3306)),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "personalv5"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return " ".join(s.upper().split())


def _label(novedad_ministerio):
    """'01-POR RAZONES DE ENFERMEDAD' -> '01 - POR RAZONES DE ENFERMEDAD'
    (formato del desplegable de la Intranet, igual que el build_mapa_inverso viejo)."""
    partes = str(novedad_ministerio).split("-", 1)
    return f"{partes[0]} - {partes[1]}" if len(partes) == 2 else str(novedad_ministerio)


def cargar_mapa_carga():
    """{(novedad_siape_norm, codigo_cie): label} con las filas de carga activas."""
    with conn() as cn, cn.cursor() as cur:
        cur.execute(
            "SELECT novedad_siape, codigo_cie, novedad_ministerio FROM mapeo_novedades "
            "WHERE activo = 1 AND usar_para_cargar = 1"
        )
        rows = cur.fetchall()
    return {(norm(r["novedad_siape"]), (r["codigo_cie"] or "").strip().upper()): _label(r["novedad_ministerio"])
            for r in rows}


def _fecha(v):
    import pandas as pd
    if v is None or (isinstance(v, float) and v != v):
        return None
    if isinstance(v, (int, float)):
        return (pd.Timestamp("1899-12-30") + pd.Timedelta(days=float(v))).date()
    if hasattr(v, "year"):
        return pd.Timestamp(v).date()
    t = str(v).strip()[:10]
    # OJO: nada de dayfirst=True generico: '2026-09-01' lo lee como 9 de enero
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            pass
    return None


def cargar_licencias(path=LICENCIAS_PATH):
    """{dni: [(novedad_norm, desde, hasta, cie, diagnostico, resolucion), ...]}.
    Devuelve {} si el archivo no esta (la carga sigue con la regla general)."""
    import pandas as pd
    out = defaultdict(list)
    if not Path(path).exists():
        print(f"AVISO: no existe {path} — sin regla de CIE en esta corrida")
        return out
    df = pd.read_excel(path)
    for _, r in df.iterrows():
        try:
            dni = int(r["NRO_DOCUMENTO"])
        except Exception:
            continue
        d1, d2 = _fecha(r.get("FECHA_DESDE")), _fecha(r.get("FECHA_HASTA"))
        if not d1 or not d2:
            continue
        cie = str(r.get("CODIGO_OMS", "") or "").strip().upper()
        if cie.endswith(".0"):
            cie = cie[:-2]
        out[dni].append((norm(r.get("NOVEDAD")), d1, d2, cie,
                         str(r.get("DIAGNOSTICO", "") or "").strip(),
                         str(r.get("RESOLUCION", "") or "").strip().upper()))
    return out


def cie_de(licencias, dni, novedad_siape, desde, hasta):
    """CIE de la licencia del agente que cubre esa novedad: mismo DNI, misma
    NOVEDAD y el rango se cruza. None si no hay o es relleno."""
    try:
        dni = int(dni)
    except Exception:
        return None
    d1, d2 = _fecha(desde), _fecha(hasta)
    if not d1 or not d2:
        return None
    nov = norm(novedad_siape)
    for l_nov, l1, l2, cie, _diag, _res in licencias.get(dni, ()):
        if l_nov == nov and l1 <= d2 and l2 >= d1 and cie and cie not in CIE_RELLENO:
            return cie
    return None


def elegir_label(mapa, licencias, dni, novedad_siape, desde, hasta):
    """Devuelve (label, cie, por_cie). por_cie=True si lo decidio una fila de CIE."""
    nov = norm(novedad_siape)
    cie = cie_de(licencias, dni, novedad_siape, desde, hasta) if licencias else None
    if cie and (nov, cie) in mapa:
        return mapa[(nov, cie)], cie, True
    return mapa.get((nov, "")), cie, False


_PUNTERO = {}


def items_desde_registros(script, registros, inicio=None):
    """Robots que llevan su resultado en una lista `registros` (filas Nombre/DNI/
    Novedad/Desde/Hasta/Estado/Detalle, la del Excel de resultado):
    - al empezar: items_desde_registros(script, registros, inicio=len(registros))
    - despues de cada guardar_log: items_desde_registros(script, registros)
    registra en script_run_items solo las filas NUEVAS de esta corrida."""
    k = id(registros)
    if inicio is not None:
        _PUNTERO[k] = inicio
        return
    if k not in _PUNTERO:
        return
    for r in registros[_PUNTERO[k]:]:
        registrar_item(script, r.get("DNI"), r.get("Nombre"), r.get("Novedad"),
                       r.get("Desde"), r.get("Hasta"), r.get("Estado"), r.get("Detalle"))
    _PUNTERO[k] = len(registros)


def registrar_run(script_id, descripcion, estado, motivo=None, filas=None, archivo=None, duracion_seg=None):
    """Una fila en script_runs (la crea si no existe, igual que los otros robots)."""
    try:
        with conn() as cn, cn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS script_runs (
                  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                  script VARCHAR(120) NOT NULL,
                  run_uid VARCHAR(32) NULL,
                  descripcion VARCHAR(255) NULL,
                  estado ENUM('ok','error') NOT NULL,
                  motivo VARCHAR(500) NULL,
                  filas INT NULL,
                  archivo VARCHAR(500) NULL,
                  duracion_seg INT NULL,
                  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  PRIMARY KEY (id),
                  KEY idx_script_runs__script_fecha (script, actualizado_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """
            )
            cur.execute(
                "INSERT INTO script_runs (script, run_uid, descripcion, estado, motivo, filas, archivo, duracion_seg) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (script_id, RUN_UID, descripcion, estado, (motivo or "")[:500] or None, filas,
                 str(archivo) if archivo else None, duracion_seg),
            )
            cn.commit()
    except Exception as e:
        print(f"AVISO: no pude registrar el resultado en script_runs: {e}")


def sufijo_dep(dependencia):
    return {"HOSPITAL": "hospital", "UPA 4": "upa4", "UPA 18": "upa18"}.get(str(dependencia).upper(), "hospital")
