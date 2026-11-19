"""
pase_planta.py — mantiene la carpeta de Pase a planta al día con DOCU, SIEMPRE en JPG.

  DOCU\\<dni>\\<subcarpeta> → PASE_A_PLANTA_DIR\\<HTAL|UPA 18|UPA 4>\\<APELLIDO NOMBRE>\\<NOMBRE>.jpg

Documentos: TODOS los del orden del trámite (orden_documentos_expediente, "PASE A TRANSITORIA"),
con el nombre que se usa a mano (NACIONAL, PROVINCIAL, RDAM, TITULO, DDJJ SALUD…). Ver DOCS.
- Agentes de TODAS las tandas (tramites_tanda_interinos), o de --tanda.
- Qué se toma de DOCU: el archivo más nuevo de la(s) subcarpeta(s). Si es una imagen, se toman TODAS
  las imágenes (son las hojas sueltas: incomp.1.jpg, incomp.2.jpg…); si es un PDF, ese PDF.
- Todo sale en JPG: cada hoja del PDF a una imagen (200 dpi, máx. 1700 px de ancho), PNG/BMP/TIFF se
  pasan a JPG, JPG se copia. Una hoja → NOMBRE.jpg; varias → NOMBRE 1.jpg, NOMBRE 2.jpg…
- Si la carpeta del agente ya tiene ese documento (por nombre, ver "ya" en DOCS):
    · si en DOCU hay uno MÁS NUEVO → se reemplaza: lo anterior se mueve a la subcarpeta "viejos";
    · si no, no se toca.
- Control JPG: cualquier archivo de la carpeta del agente que no sea JPG (PDF, PNG, JPEG…) se pasa a
  JPG con su mismo nombre y el original se mueve a "viejos". Lo que no se puede pasar (Word, etc.)
  queda en el control (no_jpg).
- Nunca borra: lo que sale va a "viejos". Si el agente ya tiene carpeta (armada a mano) en cualquier
  dependencia, usa esa.
- Planilla de compatibilidad: solo la del año en curso; si en DOCU hay solo una vieja, figura como
  faltante ("solo hay de 2025: falta la de 2026").
- Ético: solo el "Antecedentes Eticos <fecha>" que deja el robot del mail (en "Etico (si lo tuviere)"
  de DOCU hay notas de toma de posesión mal archivadas, 12/11/2026).
- Opcionales ("si lo tuviere", "Solo choferes"…): si no están en DOCU no figuran como faltantes.

Lo corre el robot pase_planta cada 2 minutos (run_robot.py pase_planta) y el botón "📦 Pase a planta"
de Trámites (POST /tramites-documentales/tandas/pase-planta, con --json).
  python pase_planta.py [--dry-run] [--tanda "TANDA 1"] [--json]
Sin cambios imprime "[sin novedades]" y run_robot no registra la corrida (no llena el historial).
"""
import argparse
import hashlib
import io
import json
import os
import re
import shutil
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

import mapeo_novedades as MN  # conn() + .env

BASE = Path(os.environ.get("PASE_A_PLANTA_DIR") or r"D:\Pase a planta\PASE A PLANTA PERMANENTE 2026")
DOCU = Path(os.environ.get("TRAMITES_DOCU_BASE_DIR") or r"D:\G\DOCU")
ESTADO = Path(__file__).resolve().parent / "logs" / "pase_planta_estado.json"
VIEJOS = "viejos"


def D(etiqueta, subs, nombre, ya, no=None, opcional=False, filtro=None, solo_anio=False, una_hoja=False):
    return {"etiqueta": etiqueta, "subs": subs, "nombre": nombre, "ya": re.compile(ya, re.I),
            "no": re.compile(no, re.I) if no else None, "opcional": opcional,
            "filtro": re.compile(filtro, re.I) if filtro else None, "solo_anio": solo_anio, "una_hoja": una_hoja}


# Orden del trámite (PASE A TRANSITORIA, leyes 10430 y 10471). subs = carpetas de DOCU (las del botón
# Subcarpetas); nombre = cómo se llama en Pase a planta; ya = cómo se reconoce uno puesto a mano.
DOCS = [
    D("Planilla de datos personales", ["Planilla de datos personales"], "PLANILLA DE DATOS PERSONALES", r"datos personales"),
    D("DNI", ["DNI"], "DNI", r"^dni\b", no=r"hij"),
    D("Anexo 1 Ley 14783", ["Anexo 1 Ley 14783 (Solo si corresponde)"], "ANEXO 1 LEY 14783", r"anexo", opcional=True),
    D("Certificado de nacimiento", ["Certificado de nacimiento (Solo acompaña Anexo 1)"], "CERTIFICADO DE NACIMIENTO",
      r"nacimiento", no=r"hij", opcional=True),
    D("Carta de ciudadanía", ["Carta de ciudadania"], "CARTA DE CIUDADANIA", r"ciudadan", opcional=True),
    D("Certificado de nacimiento hijo/a", ["Certificado de nacimiento hijo_a (Solo Extranjeros)"], "CERTIFICADO DE NACIMIENTO HIJO",
      r"nacimiento.*hij", opcional=True),
    D("DNI hijo/as", ["DNI hijo_as (Solo Extranjeros)"], "DNI HIJO", r"dni.*hij", opcional=True),
    D("CUIL", ["CUIL"], "CUIL", r"cuil"),
    D("Curriculum", ["Curriculum"], "CURRICULUM", r"curr[ií]cul|^cv\b"),
    D("Título", ["Titulo"], "TITULO", r"t[ií]tulo"),
    D("Ético", ["Etico (si lo tuviere)", "Etico"], "ETICO", r"[eé]tic", opcional=True, filtro=r"^Antecedentes Eticos", una_hoja=True),
    D("Matrícula", ["Matricula (si la tuviere)", "Matricula"], "MATRICULA", r"matr[ií]cula", opcional=True),
    D("Carnet de conducir", ["Carnet de conducir (Solo choferes)"], "CARNET DE CONDUCIR", r"carnet|^licencia", opcional=True),
    D("DDJJ habilitación para conducir", ["Declaracion Jurada Habilitacion para conducir (Solo Chofer)"], "DDJJ CONDUCIR",
      r"(ddjj|declaraci).*conduc", opcional=True),
    D("DISPO conducción de vehículos oficiales", ["DISPO para conduccion de Vehiculos oficiales (Solo Chofer)"], "DISPO CONDUCCION",
      r"dispo|autorizaci[oó]n manejo", opcional=True),
    D("Declaración jurada", ["Declaracion jurada"], "DECLARACION JURADA", r"declaraci[oó]n jurada|^ddjj", no=r"salud|conduc"),
    D("Planilla de compatibilidad", ["Planilla de incompatibilidad"], "PLANILLA DE COMPATIBILIDAD", r"compatib", solo_anio=True),
    D("Antecedentes provinciales", ["Certificado ant. Provinciales"], "PROVINCIAL", r"provincial", una_hoja=True),
    D("Antecedentes nacionales", ["Certificado ant. Nacionales"], "NACIONAL", r"nacional", una_hoja=True),
    D("DDJJ condiciones de salud", ["DDJJ Cond. De Salud"], "DDJJ SALUD", r"salud"),
    D("Certificado de discapacidad", ["Certificado de discapacidad (Terminos Ley 10592)"], "CERTIFICADO DE DISCAPACIDAD",
      r"discapac", opcional=True),
    D("Apto psicofísico", ["Certificado Apto Psicofisico"], "APTO PSICOFISICO", r"apto|psicof"),
    D("RDAM", ["Libre de deuda (RDAM)", "RDAM"], "RDAM", r"rdam"),
    D("Constancia de aceptación SIAPE", ["Constancia de Aceptacion SIAPE"], "CONSTANCIA DE ACEPTACION SIAPE", r"aceptaci"),
    D("Certificado de aportantes (IPS)", ["Certificado de aportantes (IPS)"], "IPS", r"\bips\b|aportante"),
    D("Carátula SIAPE", ["Caratula SIAPE"], "CARATULA SIAPE", r"car[aá]tula"),
]
DEPS = ["HTAL", "UPA 18", "UPA 4"]
IGNORAR = re.compile(r"^(thumbs\.db|desktop\.ini|~\$.*)$", re.I)
IMAGEN = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
DPI = 200
ANCHO_MAX = 1700   # px (= A4 a 200 dpi): hay PDF con páginas gigantes (escaneos de 34")
MARGEN_SEG = 60    # DOCU tiene que ser al menos 1 min más nuevo para reemplazar

SQL = """
SELECT DISTINCT t.dni,
       TRIM(CONCAT(COALESCE(p.apellido, ''), ' ', COALESCE(p.nombre, ''))) AS apnom,
       (SELECT dep.nombre
          FROM agentes_servicios s
          LEFT JOIN servicios sv ON sv.id = s.servicio_id AND sv.deleted_at IS NULL
          LEFT JOIN reparticiones r ON r.id = sv.reparticion_id AND r.deleted_at IS NULL
          LEFT JOIN dependencias dep ON dep.id = r.dependencia_id AND dep.deleted_at IS NULL
         WHERE s.dni = t.dni AND s.deleted_at IS NULL
           AND (s.fecha_hasta IS NULL OR s.fecha_hasta >= CURDATE())
         ORDER BY s.fecha_desde DESC, s.id DESC LIMIT 1) AS dependencia
FROM tramites_tanda_interinos t
JOIN personal p ON p.dni = t.dni AND p.deleted_at IS NULL
{where}
ORDER BY apnom
"""


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Za-z0-9]+", " ", s).strip().upper()


def dep_de(nombre):
    n = (nombre or "").upper()
    if re.search(r"UPA\s*0*18\b", n):
        return "UPA 18"
    if re.search(r"UPA\s*0*4\b", n):
        return "UPA 4"
    if re.search(r"HIGA|EVITA|HOSPITAL|HTAL", n):
        return "HTAL"
    return None


def segmento(s):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", s).strip().rstrip(".")


def orden_natural(p):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", p.name)]


def mtime(f):
    return f.stat().st_mtime


def anio_de(f):
    return datetime.fromtimestamp(mtime(f)).year


def es_de(doc, nombre_archivo):
    return bool(doc["ya"].search(nombre_archivo)) and not (doc["no"] and doc["no"].search(nombre_archivo))


def elegir_origen(carpetas, filtro=None, solo_anio=None, una_hoja=False):
    """Lista de archivos a pasar (en orden) según la regla de la cabecera, o []."""
    fs = []
    for c in carpetas:
        if c.is_dir():
            fs += [f for f in c.iterdir() if f.is_file() and not IGNORAR.match(f.name)
                   and (f.suffix.lower() in IMAGEN or f.suffix.lower() == ".pdf")
                   and (filtro is None or filtro.search(f.name))
                   and (solo_anio is None or anio_de(f) == solo_anio)]
    if not fs:
        return []
    nuevo = max(fs, key=mtime)
    dia = datetime.fromtimestamp(mtime(nuevo)).date()

    def imagenes_del_dia(carpeta):
        return sorted([f for f in fs if f.suffix.lower() in IMAGEN and f.parent == carpeta
                       and datetime.fromtimestamp(mtime(f)).date() == dia], key=orden_natural)

    if not una_hoja:
        return imagenes_del_dia(nuevo.parent) if nuevo.suffix.lower() in IMAGEN else [nuevo]
    # Certificado (una_hoja): si el mismo día llegó dos veces (la foto de una hoja y el PDF original
    # partido en 4 páginas, Lambertini 12/11/2026) gana la versión con menos hojas útiles;
    # a igual cantidad, la más nueva.
    opciones = [[f] for f in fs if f.suffix.lower() == ".pdf" and datetime.fromtimestamp(mtime(f)).date() == dia]
    for c in {f.parent for f in fs if f.suffix.lower() in IMAGEN}:
        imgs = imagenes_del_dia(c)
        if imgs:
            opciones.append(imgs)
    return min(opciones, key=lambda o: (contar_paginas(o), -max(mtime(f) for f in o)))


def pagina_vacia(pg):
    """Hoja del PDF sin contenido útil: casi sin tinta oscura (el PDF de la Policía trae una hoja que solo
    tiene la "D" gris clarito de la marca de agua "DRA", Lambertini 12/11/2026). Se mira la hoja
    renderizada chica: menos de 0,2 % de píxeles oscuros = vacía."""
    try:
        import pymupdf
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(0.5, 0.5), colorspace=pymupdf.csGRAY)
        datos = pix.samples
        oscuros = sum(1 for v in datos if v < 160)
        return oscuros < len(datos) * 0.002
    except Exception:
        return False


def hojas_utiles(doc):
    utiles = [pg for pg in doc if not pagina_vacia(pg)]
    return utiles or list(doc)


def paginas_jpg(origenes, una_hoja=False):
    """Devuelve lista de bytes JPG, una por hoja (una_hoja: todas juntas, una debajo de la otra)."""
    from PIL import Image
    out = []
    for f in origenes:
        ext = f.suffix.lower()
        if ext == ".pdf":
            import pymupdf
            with pymupdf.open(f) as doc:
                for pg in hojas_utiles(doc):
                    zoom = min(DPI / 72, ANCHO_MAX / max(pg.rect.width, 1))
                    out.append(pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).tobytes("jpg", jpg_quality=85))
        elif ext in (".jpg", ".jpeg"):
            out.append(f.read_bytes())
        else:
            with Image.open(f) as im:
                b = io.BytesIO()
                im.convert("RGB").save(b, "JPEG", quality=88)
                out.append(b.getvalue())
    if una_hoja and len(out) > 1:
        out = [unir_vertical(out)]
    return out


def unir_vertical(hojas):
    """Varias hojas JPG -> una sola imagen (sin el blanco de arriba y abajo de cada hoja)."""
    from PIL import Image, ImageChops
    ims = []
    for datos in hojas:
        im = Image.open(io.BytesIO(datos)).convert("RGB")
        caja = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255))).convert("L").point(
            lambda v: 255 if v > 24 else 0).getbbox()
        if caja:
            im = im.crop((0, max(0, caja[1] - 20), im.width, min(im.height, caja[3] + 20)))
        ims.append(im)
    ancho = max(i.width for i in ims)
    total = Image.new("RGB", (ancho, sum(i.height for i in ims)), (255, 255, 255))
    y = 0
    for i in ims:
        total.paste(i, ((ancho - i.width) // 2, y))
        y += i.height
    b = io.BytesIO()
    total.save(b, "JPEG", quality=85)
    return b.getvalue()


def contar_paginas(origenes):
    n = 0
    for f in origenes:
        if f.suffix.lower() == ".pdf":
            import pymupdf
            with pymupdf.open(f) as doc:
                n += len(hojas_utiles(doc))
        else:
            n += 1
    return n


def nombres_destino(nombre, n):
    return [f"{nombre}.jpg"] if n == 1 else [f"{nombre} {i}.jpg" for i in range(1, n + 1)]


def a_viejos(carpeta, nombre):
    """Mueve carpeta/nombre a carpeta/viejos sin pisar. Devuelve el nombre con que quedó."""
    dv = carpeta / VIEJOS
    dv.mkdir(exist_ok=True)
    src = carpeta / nombre
    dst, n = dv / nombre, 2
    while dst.exists():
        dst, n = dv / f"{src.stem} ({n}){src.suffix}", n + 1
    shutil.move(str(src), str(dst))
    return dst.name


def escribir(carpeta, destinos, hojas, fecha=None):
    """Escribe las hojas sin pisar. fecha = mtime del original: así "más nuevo en DOCU" compara
    fechas de los documentos y no la hora en que se copiaron."""
    carpeta.mkdir(parents=True, exist_ok=True)
    for d, datos in zip(destinos, hojas):
        with open(carpeta / d, "xb") as fh:   # "x" = nunca pisa
            fh.write(datos)
        if fecha:
            os.utime(carpeta / d, (fecha, fecha))


def mismas_imagenes(origenes, carpeta, hay):
    """True si las imágenes de DOCU son exactamente las que ya están (mismo contenido)."""
    if len(origenes) != len(hay) or any(f.suffix.lower() not in (".jpg", ".jpeg") for f in origenes):
        return False
    h = lambda p: hashlib.sha1(p.read_bytes()).hexdigest()
    return sorted(h(f) for f in origenes) == sorted(h(carpeta / f) for f in hay)


def pasar(dry_run=False, tanda=None, log=print):
    """Devuelve {base, ejecutado, totales, rows, no_jpg, convertidos}. log recibe solo lo que cambia o falla."""
    tot = {"agentes": 0, "copiar": 0, "copiados": 0, "reemplazar": 0, "reemplazados": 0, "ya_esta": 0,
           "falta_en_docu": 0, "errores": 0, "no_jpg": 0}
    res = {"base": str(BASE), "ejecutado": not dry_run, "totales": tot, "rows": [], "no_jpg": [], "convertidos": []}
    if not BASE.exists():
        raise RuntimeError(f"No existe la carpeta {BASE}")
    anio = datetime.now().year

    existentes = {}
    for d in DEPS:
        dd = BASE / d
        if dd.is_dir():
            for e in dd.iterdir():
                if e.is_dir():
                    existentes[norm(e.name)] = e

    with MN.conn() as cn, cn.cursor() as cur:
        # Las tandas de renovación (becarios de radicación, 17/11/2026) no van a Pase a planta.
        cur.execute(SQL.format(where="WHERE t.tanda = %s" if tanda else "WHERE t.tanda NOT LIKE '%%RENOVACI%%'"),
                    (tanda,) if tanda else ())
        agentes = cur.fetchall()

    for a in agentes:
        tot["agentes"] += 1
        dni = int(a["dni"])
        apnom = re.sub(r"\s+", " ", a["apnom"] or "").strip().upper()
        row = {"dni": dni, "apellidoNombre": apnom, "dependencia": None, "carpeta": None,
               "carpetaNueva": False, "docs": [], "error": None}
        res["rows"].append(row)
        carpeta = existentes.get(norm(apnom))
        if carpeta is not None:
            row["dependencia"] = carpeta.parent.name
        else:
            dep = dep_de(a["dependencia"])
            row["dependencia"] = dep
            if not dep or not apnom:
                row["error"] = f"No sé a qué carpeta va la dependencia \"{a['dependencia'] or 'sin dependencia'}\""
                tot["errores"] += 1
                log(f"  {dni} {apnom}: {row['error']}")
                continue
            carpeta = BASE / dep / segmento(apnom)
            row["carpetaNueva"] = not carpeta.exists()
        row["carpeta"] = str(carpeta.relative_to(BASE))
        en_destino = [f.name for f in carpeta.iterdir() if f.is_file() and not IGNORAR.match(f.name)] if carpeta.is_dir() else []

        # ── Control JPG: lo que no es JPG se pasa a JPG (mismo nombre) y el original va a "viejos".
        for f in list(en_destino):
            p = carpeta / f
            ext = p.suffix.lower()
            if ext == ".jpg":
                continue
            if ext != ".pdf" and ext not in IMAGEN:
                res["no_jpg"].append({"dni": dni, "apellidoNombre": apnom, "archivo": f"{row['carpeta']}\\{f}"})
                tot["no_jpg"] += 1
                continue
            item = {"archivo": f"{row['carpeta']}\\{f}", "estado": "convertir", "detalle": None}
            res["convertidos"].append(item)
            if dry_run:
                continue
            try:
                hojas = paginas_jpg([p])
                destinos = nombres_destino(p.stem, len(hojas))
                ya = [d for d in destinos if (carpeta / d).exists()]
                if ya and len(ya) != len(destinos):
                    raise FileExistsError(f"ya hay {ya[0]} pero no todas las hojas")
                if not ya:
                    escribir(carpeta, destinos, hojas, mtime(p))
                    en_destino.extend(destinos)
                movido = a_viejos(carpeta, f)
                en_destino.remove(f)
                item["estado"] = "convertido"
                item["detalle"] = (f"ya estaba en JPG; el {p.suffix} fue a viejos" if ya
                                   else f"{', '.join(destinos)} (el original fue a viejos\\{movido})")
                log(f"  {dni} {apnom}: {f} -> {item['detalle']}")
            except Exception as e:
                item["estado"] = "error"
                item["detalle"] = str(e)[:300]
                tot["errores"] += 1
                log(f"  ERROR {dni} {apnom}: no pude pasar {f} a JPG: {e}")

        # ── Documentos del trámite
        for doc in DOCS:
            subs = [DOCU / str(dni) / s for s in doc["subs"]]
            hay = [f for f in en_destino if es_de(doc, f)]
            origenes = elegir_origen(subs, doc["filtro"], anio if doc["solo_anio"] else None, doc["una_hoja"])
            if doc["opcional"] and not hay and not origenes:
                continue   # opcional que el agente no tiene: no figura
            item = {"doc": doc["etiqueta"], "estado": "", "origen": None, "destino": None, "detalle": None}
            row["docs"].append(item)
            if origenes:
                item["origen"] = ", ".join(f"{f.parent.name}\\{f.name}" for f in origenes)
            if hay:
                item["destino"] = ", ".join(hay)
                nuevo_docu = origenes and max(mtime(f) for f in origenes) > max(mtime(carpeta / f) for f in hay) + MARGEN_SEG
                nuevo_docu = nuevo_docu and not mismas_imagenes(origenes, carpeta, hay)
                # Certificado que quedó partido en varios JPG (PROVINCIAL 1..4) por una copia vieja del
                # robot: se rehace en uno solo y las partes van a viejos (17/11/2026).
                partido = bool(doc["una_hoja"] and len(hay) > 1 and origenes
                               and all(re.fullmatch(re.escape(doc["nombre"]) + r" \d+\.jpg", f, re.I) for f in hay))
                if not nuevo_docu and not partido:
                    item["estado"] = "ya_esta"
                    tot["ya_esta"] += 1
                    continue
                accion = "reemplazar"
            else:
                if not origenes:
                    item["estado"] = "falta_en_docu"
                    viejos = doc["solo_anio"] and elegir_origen(subs, doc["filtro"])
                    item["detalle"] = (f"En DOCU solo hay de {max(anio_de(f) for f in viejos)}: falta la de {anio}" if viejos
                                       else f"No hay nada en DOCU\\{dni}\\{doc['subs'][0]}")
                    tot["falta_en_docu"] += 1
                    continue
                accion = "copiar"
            try:
                if dry_run:
                    item["estado"] = accion
                    nuevos = nombres_destino(doc["nombre"], 1 if doc["una_hoja"] else contar_paginas(origenes))
                    item["detalle"] = (f"{'estaba partido en varias hojas' if partido else 'en DOCU hay uno más nuevo'}: "
                                       f"{', '.join(hay)} va a viejos -> {', '.join(nuevos)}"
                                       if accion == "reemplazar" else None)
                    if accion == "copiar":
                        item["destino"] = ", ".join(nuevos)
                    tot[accion] += 1
                    continue
                hojas = paginas_jpg(origenes, doc["una_hoja"])
                destinos = nombres_destino(doc["nombre"], len(hojas))
                if accion == "reemplazar":
                    for f in hay:
                        a_viejos(carpeta, f)
                        en_destino.remove(f)
                choque = [d for d in destinos if (carpeta / d).exists()]
                if choque:
                    raise FileExistsError(f"ya existe {choque[0]}")
                escribir(carpeta, destinos, hojas, max(mtime(f) for f in origenes))
                en_destino.extend(destinos)
                if accion == "reemplazar":
                    item["estado"] = "reemplazado"
                    item["detalle"] = f"{', '.join(hay)} -> viejos"
                    tot["reemplazados"] += 1
                else:
                    item["estado"] = "copiado"
                    tot["copiados"] += 1
                item["destino"] = ", ".join(destinos)
                log(f"  {dni} {apnom}: {doc['etiqueta']} {item['estado']} -> {row['carpeta']}\\{item['destino']}"
                    + (f" ({item['detalle']})" if item["detalle"] else ""))
            except Exception as e:
                item["estado"] = "error"
                item["detalle"] = str(e)[:300]
                tot["errores"] += 1
                log(f"  ERROR {dni} {apnom}: {doc['etiqueta']}: {e}")
    return res


def hubo_novedades(res, lineas_error):
    """True si cambió algo o si los errores no son los mismos de la corrida anterior."""
    t = res["totales"]
    convertidos = sum(1 for c in res["convertidos"] if c["estado"] == "convertido")
    firma = hashlib.sha1("\n".join(sorted(lineas_error)).encode("utf-8")).hexdigest()
    try:
        anterior = json.loads(ESTADO.read_text(encoding="utf-8")).get("errores")
    except Exception:
        anterior = None
    try:
        ESTADO.parent.mkdir(exist_ok=True)
        ESTADO.write_text(json.dumps({"errores": firma, "fecha": datetime.now().isoformat(timespec="seconds")}), encoding="utf-8")
    except Exception:
        pass
    return bool(t["copiados"] or t["reemplazados"] or convertidos or firma != anterior)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="vista previa: muestra qué haría, no toca nada")
    ap.add_argument("--tanda", help="solo esa tanda (por defecto todas)")
    ap.add_argument("--json", action="store_true", help="salida JSON (la usa la API)")
    args = ap.parse_args()
    if args.json:
        sys.stdout.reconfigure(encoding="utf-8")   # la API lo lee en UTF-8
        try:
            res = pasar(args.dry_run, args.tanda, log=lambda *_: None)
            sys.stdout.write(json.dumps({"ok": True, "data": res}, ensure_ascii=False))
            return 0
        except Exception as e:
            sys.stdout.write(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
            return 1
    errores = []

    def log(msg):
        print(msg)
        if "ERROR" in msg or "No sé" in msg:
            errores.append(msg.strip())

    res = pasar(args.dry_run, args.tanda, log)
    t = res["totales"]
    conv = res["convertidos"]
    if conv:
        print(f"  {'A pasar' if args.dry_run else 'Pasados'} a JPG: {sum(1 for c in conv if c['estado'] in ('convertir', 'convertido'))}")
    for x in res["no_jpg"]:
        print(f"  NO SE PUEDE PASAR A JPG: {x['archivo']}")
    if args.dry_run:
        print(f"Pase a planta (vista previa): {t['agentes']} agentes, {t['copiar']} a copiar, {t['reemplazar']} a reemplazar, "
              f"{t['ya_esta']} ya estaban, {t['falta_en_docu']} faltan en DOCU, {t['errores']} con error")
        return 0
    print(f"Pase a planta: {t['copiados']} copiado(s), {t['reemplazados']} reemplazado(s), "
          f"{sum(1 for c in conv if c['estado'] == 'convertido')} pasado(s) a JPG, {t['falta_en_docu']} faltan en DOCU, "
          f"{t['errores']} con error")
    if not hubo_novedades(res, errores):
        print("[sin novedades]")
    # Errores de datos (archivo abierto, sin dependencia) no son caída del robot: quedan en el log.
    return 0


if __name__ == "__main__":
    sys.exit(main())
