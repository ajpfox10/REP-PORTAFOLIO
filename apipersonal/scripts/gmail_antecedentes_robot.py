"""
Baja de la casilla recepciondeantecedentesrrhhkm@gmail.com (API de Gmail, ver
gmail_antecedentes.py) los certificados de antecedentes penales que mandan los
agentes y los deja en el legajo digital:

  D:\\G\\DOCU\\<dni>\\Certificado ant. Nacionales\\Antecedentes Nacionales <fecha>.pdf
  D:\\G\\DOCU\\<dni>\\Certificado ant. Provinciales\\Antecedentes Provinciales <fecha>.pdf

(mismas subcarpetas que usa el clasificador de DOCU / Trámites).

Por cada mail con PDF que no tenga etiqueta del robot:
  - tipo: por el texto del PDF (Reincidencia = nacional; Registro de Antecedentes de
    la Policía / Ministerio de Seguridad = provincial); si no trae texto, por el
    nombre del adjunto / asunto ("nacional", "provincial", "pcial").
  - DNI: primero el que figura en el PDF junto a "DNI"/"documento"; si no, el que
    aparezca en el asunto, el cuerpo o el nombre del adjunto y exista en `personal`.
    Si quedan dos DNI distintos, no adivina.
  - identificado -> DOCU + etiqueta "Robot/Procesado".
  - sin DNI o sin tipo -> D:\\G\\VARIOS\\ANTECEDENTES SIN IDENTIFICAR\\ + etiqueta
    "Robot/Sin identificar" (no se vuelve a procesar; se revisa a mano).

Detalle por adjunto: script_run_items (página Robots). Correr con run_robot.py.

Uso:
  python gmail_antecedentes_robot.py --dry-run     # lee y clasifica, no guarda ni etiqueta
  python gmail_antecedentes_robot.py
"""
import argparse
import base64
import hashlib
import io
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import pypdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN   # conn() + registrar_item() + .env
import gmail_antecedentes as G

SCRIPT_ID = "gmail_antecedentes"
DOCU = Path(os.environ.get("DOCU_DIR", r"D:\G\DOCU"))
SIN_IDENTIFICAR = Path(os.environ.get("ANTECEDENTES_SIN_IDENTIFICAR_DIR", r"D:\G\VARIOS\ANTECEDENTES SIN IDENTIFICAR"))
ETIQ_OK = "Robot/Procesado"
ETIQ_REVISAR = "Robot/Sin identificar"
# in:anywhere = todas las carpetas (Recibidos, archivados, Spam y Papelera): Gmail manda a spam
# los mails de remitentes nuevos que traen solo adjuntos (pasó con el primero real, 03/11).
# PDF o foto (PNG/JPG): hay agentes que mandan una captura del certificado (Montiel, 06/11).
CONSULTA = (f'in:anywhere has:attachment {{filename:pdf filename:png filename:jpg filename:jpeg}} '
            f'-label:"{ETIQ_OK}" -label:"{ETIQ_REVISAR}"')

TIPOS = {
    "nacional":   ("Certificado ant. Nacionales", "Antecedentes Nacionales"),
    "provincial": ("Certificado ant. Provinciales", "Antecedentes Provinciales"),
}


# ───────────────────────── lectura ─────────────────────────

def texto_pdf(datos):
    try:
        r = pypdf.PdfReader(io.BytesIO(datos))
        return "\n".join((p.extract_text() or "") for p in r.pages[:4])
    except Exception:
        return ""


def tipos_de(texto_pdf_norm, pistas_norm):
    """['nacional'], ['provincial'], los dos (PDF con ambos certificados) o []."""
    tipos = []
    if re.search(r"REINCIDENCIA", texto_pdf_norm):
        tipos.append("nacional")
    if re.search(r"REGISTRO DE ANTECEDENTES", texto_pdf_norm) and re.search(r"POLICIA|MINISTERIO DE SEGURIDAD", texto_pdf_norm):
        tipos.append("provincial")
    if tipos:
        return tipos
    if re.search(r"PROVINCIAL|PCIAL|PROVINCIA", pistas_norm):
        return ["provincial"]
    if re.search(r"NACIONAL|REINCIDENCIA", pistas_norm):
        return ["nacional"]
    return []


_NUM = r"(\d{1,2}\.?\d{3}\.?\d{3})"


def dnis_en(texto):
    """[(dni, fuerte)]: fuerte = pegado a DNI / D.N.I. / documento."""
    out = []
    for m in re.finditer(r"(?:D\.?\s?N\.?\s?I\.?|DOCUMENTO|DOC\.)\D{0,25}" + _NUM, texto, re.I):
        out.append((int(m.group(1).replace(".", "")), True))
    for m in re.finditer(r"(?<![\d.])" + _NUM + r"(?![\d.])", texto):
        out.append((int(m.group(1).replace(".", "")), False))
    return [(d, f) for d, f in out if 1_000_000 <= d <= 99_999_999]


def en_personal(cn, dnis):
    dnis = sorted(set(dnis))
    if not dnis:
        return {}
    with cn.cursor() as cur:
        cur.execute(f"SELECT dni, apellido, nombre FROM personal WHERE dni IN ({','.join(['%s'] * len(dnis))})", dnis)
        return {int(r["dni"]): f"{r['apellido'] or ''}, {r['nombre'] or ''}".strip(", ") for r in cur.fetchall()}


_PERSONAL = None


def por_nombre(cn, texto):
    """Agentes cuyo apellido completo y primer nombre aparecen como palabras en el texto.
    Desempata por cuántos nombres coinciden. [(dni, 'APELLIDO, Nombre')]"""
    global _PERSONAL
    if _PERSONAL is None:
        with cn.cursor() as cur:
            cur.execute("SELECT dni, apellido, nombre FROM personal WHERE dni IS NOT NULL")
            _PERSONAL = [(int(r["dni"]), MN.norm(r["apellido"]).split(), MN.norm(r["nombre"]).split(),
                          f"{r['apellido'] or ''}, {r['nombre'] or ''}") for r in cur.fetchall()]
    palabras = set(re.sub(r"[^A-Z ]", " ", MN.norm(texto)).split())
    puntaje = {}
    for dni, ape, nom, etiqueta in _PERSONAL:
        if ape and nom and all(p in palabras for p in ape) and nom[0] in palabras:
            puntaje[(dni, etiqueta)] = sum(p in palabras for p in nom)
    if not puntaje:
        return []
    mejor = max(puntaje.values())
    return [k for k, v in puntaje.items() if v == mejor]


def elegir_dni(cn, texto, pistas, ocr=False):
    """(dni, nombre, detalle) o (None, None, motivo). Con ocr=True los dígitos del
    certificado no son confiables: solo cuentan si el DNI existe en personal."""
    del_pdf = dnis_en(texto)
    otros = dnis_en(pistas)
    conocidos = en_personal(cn, [d for d, _ in del_pdf + otros])
    if ocr:
        del_pdf = [(d, f) for d, f in del_pdf if d in conocidos]

    fuertes = {d for d, f in del_pdf if f}
    if len(fuertes) == 1:
        d = fuertes.pop()
        return d, conocidos.get(d), ("DNI del certificado" if d in conocidos else "DNI del certificado (no está en personal)")
    if len(fuertes) > 1:
        return None, None, f"el certificado trae varios DNI: {sorted(fuertes)}"

    for fuente, lista in (("certificado", del_pdf), ("asunto/cuerpo/adjunto", otros)):
        validos = {d for d, _ in lista if d in conocidos}
        if len(validos) == 1:
            d = validos.pop()
            return d, conocidos[d], f"DNI de {fuente}"
        if len(validos) > 1:
            return None, None, f"varios DNI de agentes en {fuente}: {sorted(validos)}"

    for fuente, t in (("certificado", texto), ("asunto/cuerpo/remitente", pistas)):
        cand = por_nombre(cn, t)
        if len(cand) == 1:
            return cand[0][0], cand[0][1], f"por nombre en {fuente}"
        if len(cand) > 1:
            return None, None, f"el nombre coincide con varios agentes: {[c[1] for c in cand][:4]}"
    return None, None, "no encontré el DNI ni el nombre del agente"


def texto_ocr(datos):
    """OCR con el motor de DOCU (scripts/ocr_pdf.mjs). '' si falla."""
    import subprocess
    import tempfile
    raiz = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "adjunto.pdf"
        f.write_bytes(datos)
        try:
            r = subprocess.run(["node", "scripts/ocr_pdf.mjs", str(f)], cwd=raiz, capture_output=True,
                               timeout=180, encoding="utf-8", errors="ignore")
            return r.stdout if r.returncode == 0 else ""
        except Exception as ex:
            print(f"  AVISO: OCR falló: {ex}")
            return ""


EXT_IMAGEN = (".png", ".jpg", ".jpeg")
IMAGEN_MIN_BYTES = 20_000     # menos que esto = logo / firma del mail, no una foto del certificado


def partes_adjuntos(payload):
    """(nombre, attachmentId, es_imagen) de los PDF y de las fotos (PNG/JPG) del mail."""
    pila = [payload]
    while pila:
        p = pila.pop()
        pila.extend(p.get("parts") or [])
        nombre = p.get("filename") or ""
        body = p.get("body", {})
        if not body.get("attachmentId"):
            continue
        mime = p.get("mimeType") or ""
        if mime == "application/pdf" or nombre.lower().endswith(".pdf"):
            yield nombre or "adjunto.pdf", body["attachmentId"], False
        elif (mime in ("image/png", "image/jpeg") or nombre.lower().endswith(EXT_IMAGEN)) \
                and body.get("size", 0) >= IMAGEN_MIN_BYTES:
            yield nombre or "adjunto.jpg", body["attachmentId"], True


def imagen_a_pdf(datos):
    """Foto del certificado -> PDF de una página (así se guarda y se lee por OCR igual que un escaneado)."""
    from PIL import Image, ImageOps
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(datos)))
    if img.mode != "RGB":
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format="PDF", resolution=200.0)
    return out.getvalue()


def cuerpo_texto(payload):
    trozos, pila = [], [payload]
    while pila:
        p = pila.pop()
        pila.extend(p.get("parts") or [])
        if p.get("mimeType") in ("text/plain", "text/html") and p.get("body", {}).get("data"):
            t = base64.urlsafe_b64decode(p["body"]["data"]).decode("utf-8", "ignore")
            trozos.append(re.sub(r"<[^>]+>", " ", t))
    return "\n".join(trozos)


# ───────────────────────── guardado ─────────────────────────

def guardar(carpeta, nombre_base, datos):
    """Guarda sin pisar; si ya hay un archivo idéntico no duplica. Devuelve (ruta, nuevo)."""
    carpeta.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256(datos).hexdigest()
    destino, n = carpeta / f"{nombre_base}.pdf", 2
    while destino.exists():
        if hashlib.sha256(destino.read_bytes()).hexdigest() == h:
            return destino, False
        destino, n = carpeta / f"{nombre_base} ({n}).pdf", n + 1
    destino.write_bytes(datos)
    return destino, True


def registrar_archivo(cn, dni, ruta, tipo, fecha, nombre_adjunto, remitente):
    """Fila en tblarchivos (mismo formato que el scanner), para que se vea en el legajo.
    Solo agentes de personal (FK) y sin duplicar la ruta. Devuelve el id o None."""
    rel = str(ruta.relative_to(DOCU))
    with cn.cursor() as cur:
        cur.execute("SELECT id FROM tblarchivos WHERE ruta = %s AND deleted_at IS NULL", (rel,))
        fila = cur.fetchone()
        if fila:
            return fila["id"]
        cur.execute(
            "INSERT INTO tblarchivos (dni, ruta, nombre, tipo, tamanio, anio, fecha, descripcion_archivo, nombre_archivo_original) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (dni, rel, TIPOS[tipo][1], f"antecedentes_{tipo}es", f"{max(1, ruta.stat().st_size // 1024)} KB",
             fecha.year, fecha.date(),
             f"Tipo: antecedentes_{tipo}es | Carpeta: {TIPOS[tipo][0]} | Origen: mail de {remitente}"[:255],
             nombre_adjunto[:255]))
        cn.commit()
        return cur.lastrowid


def id_etiqueta(svc, nombre):
    for e in svc.users().labels().list(userId="me").execute().get("labels", []):
        if e["name"] == nombre:
            return e["id"]
    return svc.users().labels().create(userId="me", body={
        "name": nombre, "labelListVisibility": "labelShow", "messageListVisibility": "show"}).execute()["id"]


def limpio(s):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", s).strip()[:120]


# ───────────────────────── principal ─────────────────────────

def procesar_mail(svc, cn, msg_id, dry_run):
    m = svc.users().messages().get(userId="me", id=msg_id, format="full").execute()
    h = {x["name"].lower(): x["value"] for x in m["payload"].get("headers", [])}
    asunto, remitente = h.get("subject", ""), h.get("from", "")
    fecha = datetime.fromtimestamp(int(m["internalDate"]) / 1000)
    cuerpo = cuerpo_texto(m["payload"])

    resultados = []   # (ok, ...)
    for nombre, att_id, es_imagen in partes_adjuntos(m["payload"]):
        ext = Path(nombre).suffix.lower().lstrip(".")
        formato = ("JPG" if ext in ("jpg", "jpeg") else "PNG" if ext == "png" else "FOTO") if es_imagen else "PDF"
        datos = base64.urlsafe_b64decode(
            svc.users().messages().attachments().get(userId="me", messageId=msg_id, id=att_id).execute()["data"])
        if es_imagen:
            try:
                datos = imagen_a_pdf(datos)
            except Exception as ex:
                print(f"  AVISO: no pude convertir la imagen {nombre}: {ex}")
                continue
        texto = texto_pdf(datos)
        ocr = len(texto.strip()) < 60          # escaneado / foto: sin capa de texto útil
        if ocr:
            texto = texto_ocr(datos)
        pistas = f"{asunto}\n{cuerpo}\n{nombre}\n{remitente}"
        tipos = tipos_de(MN.norm(texto), MN.norm(pistas))
        dni, agente, detalle = elegir_dni(cn, texto, pistas, ocr=ocr)
        if ocr:
            detalle += " · leído por OCR"

        if dni and tipos:
            destinos = [(DOCU / str(dni) / TIPOS[t][0], f"{TIPOS[t][1]} {fecha:%Y-%m-%d}", t) for t in tipos]
            estado = "ok" if "no está en personal" not in detalle else "aviso"
        else:
            if dni and not tipos:
                detalle += " · no pude saber si es nacional o provincial"
            destinos = [(SIN_IDENTIFICAR, limpio(f"{fecha:%Y-%m-%d %H%M} {remitente.split('<')[0].strip() or 'sin remitente'} - {Path(nombre).stem}"), None)]
            estado = "aviso"

        for carpeta, nombre_base, tipo in destinos:
            if dry_run:
                ruta, nuevo = carpeta / f"{nombre_base}.pdf", True
            else:
                ruta, nuevo = guardar(carpeta, nombre_base, datos)
            txt = f"{tipo or '?'} -> {ruta}{'' if nuevo else ' (ya estaba)'} · vino en {formato} · {detalle} · de {remitente}"
            if not dry_run and tipo and agente:          # agente = está en personal (FK de tblarchivos)
                try:
                    txt += f" · tblarchivos #{registrar_archivo(cn, dni, ruta, tipo, fecha, nombre, remitente)}"
                except Exception as ex:
                    txt += f" · NO se registró en tblarchivos: {ex}"
                    estado = "aviso"
            elif not dry_run and tipo:
                txt += " · sin fila en tblarchivos (no está en personal)"
            print(f"  [{estado}] {nombre}: {txt}")
            if not dry_run:
                MN.registrar_item(SCRIPT_ID, dni=dni, nombre=agente, novedad=f"Antecedentes {tipo or '?'} · {formato}",
                                  desde=f"{fecha:%Y-%m-%d}", estado=estado, detalle=txt)
        resultados.append(destinos[0][0] != SIN_IDENTIFICAR)
    return resultados


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="lee y clasifica, no guarda ni etiqueta")
    ap.add_argument("--max", type=int, default=200, help="máximo de mails por corrida")
    args = ap.parse_args()

    svc = G.servicio()
    ids, token = [], None
    while len(ids) < args.max:
        r = svc.users().messages().list(userId="me", q=CONSULTA, maxResults=min(100, args.max - len(ids)),
                                        pageToken=token, includeSpamTrash=True).execute()
        ids += [x["id"] for x in r.get("messages", [])]
        token = r.get("nextPageToken")
        if not token:
            break
    print(f"Mails con PDF/foto sin procesar: {len(ids)}{' (dry-run)' if args.dry_run else ''}")
    if not ids:
        return 0

    etiq_ok = etiq_rev = None
    if not args.dry_run:
        etiq_ok, etiq_rev = id_etiqueta(svc, ETIQ_OK), id_etiqueta(svc, ETIQ_REVISAR)

    guardados = revisar = 0
    with MN.conn() as cn:
        for msg_id in ids:
            res = procesar_mail(svc, cn, msg_id, args.dry_run)
            guardados += sum(res)
            revisar += len(res) - sum(res)
            if not args.dry_run and res:
                etiq = etiq_ok if all(res) else etiq_rev
                cuerpo = {"addLabelIds": [etiq]}
                # si estaba en Spam o Papelera lo devuelve a Recibidos (queda a la vista y Gmail aprende)
                labels = svc.users().messages().get(userId="me", id=msg_id, format="minimal").execute().get("labelIds", [])
                fuera = [x for x in ("SPAM", "TRASH") if x in labels]
                if fuera:
                    cuerpo["removeLabelIds"] = fuera
                    cuerpo["addLabelIds"].append("INBOX")
                svc.users().messages().modify(userId="me", id=msg_id, body=cuerpo).execute()
    print(f"OK: {guardados} certificado(s) a DOCU, {revisar} sin identificar en {SIN_IDENTIFICAR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
