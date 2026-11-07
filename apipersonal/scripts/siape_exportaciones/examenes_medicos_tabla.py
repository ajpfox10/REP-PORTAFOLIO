"""
Exámenes médicos de SIAPE -> tabla `examenes_medicos_siape` (migracion 100).

  importar(xlsx, origen)   -> lo llama la exportacion "Examenes Médicos Salud"
                              (post "examenes_medicos") despues de bajar
                              EXAMENES_MEDICOS.xlsx.
  guardar(filas, origen)   -> lo usa el robot de certificados con lo que lee en
                              la grilla de Rec. Medicos -> Examenes Medicos.

La consulta 123 trae solo el periodo pedido (el año en curso): por eso se
actualiza por CODIGO_EXAMEN y nunca se borra. Una FECHA vacia no pisa una cargada.

Uso manual (carga inicial):
  python examenes_medicos_tabla.py "D:\\G\\APTOS\\APTOS.xlsx" "D:\\G\\comparacion\\EXAMENES_MEDICOS.xlsx"
"""
import re
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mapeo_novedades as MN  # conn() + .env

COLUMNAS = ("codigo_examen", "dni", "apellido", "nombre", "cuil", "organismo", "tipo_examen",
            "modalidad", "fecha", "estado_examen", "resolucion", "tipo_tramite")


def _txt(v, n):
    s = str(v if v is not None else "").strip()
    return s[:n] if s and s != "-" else None


def _fecha(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", str(v or ""))
    if m:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(v or ""))
    return date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def leer(path):
    import openpyxl
    path = Path(path)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    filas = list(wb.active.iter_rows(values_only=True))
    wb.close()
    if not filas:
        return []
    col = {str(h or "").strip().upper(): i for i, h in enumerate(filas[0])}
    req = {"NRO_DOCUMENTO", "CODIGO_EXAMEN", "TIPO_EXAMEN", "RESOLUCION"}
    if req - set(col):
        raise RuntimeError(f"{path.name}: faltan columnas {sorted(req - set(col))} (vino: {filas[0]})")
    g = lambda r, k: r[col[k]] if k in col and col[k] < len(r) else None
    out = []
    for r in filas[1:]:
        dni = int(re.sub(r"\D", "", str(g(r, "NRO_DOCUMENTO") or "")) or 0)
        codigo = _txt(g(r, "CODIGO_EXAMEN"), 30)
        if not dni or not codigo:
            continue
        out.append({
            "codigo_examen": codigo, "dni": dni,
            "apellido": _txt(g(r, "APELLIDO"), 120), "nombre": _txt(g(r, "NOMBRE"), 120),
            "cuil": _txt(g(r, "CUIT_CUIL"), 20), "organismo": _txt(g(r, "ORGANISMO"), 120),
            "tipo_examen": _txt(g(r, "TIPO_EXAMEN"), 120), "modalidad": _txt(g(r, "MODALIDAD_EXAMEN"), 60),
            "fecha": _fecha(g(r, "FECHA")), "estado_examen": _txt(g(r, "ESTADO_EXAMEN"), 60),
            "resolucion": _txt(g(r, "RESOLUCION"), 120), "tipo_tramite": _txt(g(r, "TIPO_TRAMITE"), 60),
        })
    return out


def guardar(filas, origen, archivo=None):
    """Upsert por codigo_examen. Devuelve (nuevos, actualizados)."""
    if not filas:
        return 0, 0
    cols = COLUMNAS + ("fecha_origen", "origen", "archivo")
    # fecha_origen va ANTES que fecha: una fecha de SIAPE pisa la del certificado (mig 101)
    sql = (f"INSERT INTO examenes_medicos_siape ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "
           "ON DUPLICATE KEY UPDATE fecha_origen = IF(VALUES(fecha) IS NOT NULL, 'siape', fecha_origen), "
           + ", ".join(f"{c} = COALESCE(VALUES({c}), {c})" for c in COLUMNAS if c != "codigo_examen")
           + ", origen = VALUES(origen), archivo = COALESCE(VALUES(archivo), archivo), ultima_vez = CURRENT_TIMESTAMP")
    nuevos = actualizados = 0
    with MN.conn() as cn, cn.cursor() as cur:
        for f in filas:
            cur.execute(sql, tuple(f.get(c) for c in COLUMNAS)
                        + ("siape" if f.get("fecha") else None, origen, archivo))
            # rowcount: 1 = insert, 2 = update con cambios, 0 = igual
            nuevos += cur.rowcount == 1
            actualizados += cur.rowcount == 2
        cn.commit()
    return nuevos, actualizados


MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
         "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}


def fecha_de_certificado(texto):
    """'La Plata, martes 11 de febrero de 2025.' -> date (fecha de EMISION del certificado)."""
    m = re.search(r"La Plata,\s*\S+\s+(\d{1,2})\s+de\s+([A-Za-z]+)\s+de\s+(\d{4})", texto or "", re.I)
    if not m or m.group(2).lower() not in MESES:
        return None
    return date(int(m.group(3)), MESES[m.group(2).lower()], int(m.group(1)))


def cargar_fecha_certificado(codigo, fecha):
    """Completa la fecha SOLO si SIAPE no la tiene. True si la cargo."""
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("UPDATE examenes_medicos_siape SET fecha = %s, fecha_origen = 'certificado' "
                    "WHERE codigo_examen = %s AND fecha IS NULL", (fecha, codigo))
        cn.commit()
        return cur.rowcount == 1


def marcar_certificado(codigo, archivo):
    """El certificado de este examen ya esta en DOCU (mig 102)."""
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("UPDATE examenes_medicos_siape SET certificado_archivo = %s, certificado_bajado = NOW() "
                    "WHERE codigo_examen = %s", (str(archivo), codigo))
        cn.commit()


def importar(path, origen="exportacion"):
    filas = leer(path)
    nuevos, actualizados = guardar(filas, origen, archivo=Path(path).name)
    return {"filas": len(filas), "nuevos": nuevos, "actualizados": actualizados}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    for p in sys.argv[1:]:
        r = importar(p, origen="exportacion")
        print(f"{p}: {r['filas']} filas, {r['nuevos']} nuevos, {r['actualizados']} actualizados")
