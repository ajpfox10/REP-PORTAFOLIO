"""
Baja el certificado del RDAM (Registro de Deudores Alimentarios Morosos, Ministerio de Justicia PBA)
de los agentes de las tandas de nombramiento (tramites_tanda_interinos) o de DNIs sueltos, y lo deja
en D:\\G\\DOCU\\<dni>\\RDAM\\<APELLIDO NOMBRE> RDAM aaaa-mm-dd.pdf (crea la carpeta si no existe).
Recién con el nuevo guardado borra los RDAM viejos de esa carpeta (archivos con "RDAM" en el nombre).

Usa el trámite PÚBLICO https://rdam.mjus.gba.gob.ar/solicitudCertificado: no pide login ni captcha
(el login de GDEBA sí tiene captcha: por eso no se usa). Mapeado en vivo el 03/11/2026:
  - Livewire (componente solicitud-form): wire:model tipoId (1 = DNI), nroId, sexoId
    (1 Masculino, 2 Femenino, 3 No Binario, 4 No Corresponde); botón wire:click="buscar()"
    = "Imprimir certificado".
  - Si RENAPER no trae los datos aparecen apellido / nombres (wire:model) y hay que volver a tocar
    el botón ("Debe ingresar nombre y apellido manualmente").
  - La respuesta de Livewire trae effects.redirect = /certificado-libre-deuda-RDAM/<código>, que
    devuelve el PDF directo y sin cookies. La navegación al PDF se corta (en headless sería una
    descarga) y el PDF se baja con el código.
Cada corrida pide un certificado NUEVO por agente (el trámite público no lista los anteriores).
La extensión de Chrome hace lo mismo desde Trámites documentales → "⚖️ RDAM" (rdam.js).

Detalle por agente: script_run_items (página Robots). Se puede correr con run_robot.py.

Uso:
  python descargar_rdam.py --solo-lista                    # lista, sin tocar el RDAM
  python descargar_rdam.py                                 # todas las tandas, los que no tienen RDAM
  python descargar_rdam.py --tanda "TANDA 1" --limit 5
  python descargar_rdam.py --dni xxxxxxx --forzar --headed
  python descargar_rdam.py --dni xxxxxxx,30111222        # varios DNIs sueltos
"""
import argparse
import datetime as dt
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

import mapeo_novedades as MN

SCRIPT_ID = "rdam_certificados"
DOCU = Path(os.environ.get("DOCU_DIR", r"D:\G\DOCU"))
SUBCARPETA = "RDAM"
BASE = "https://rdam.mjus.gba.gob.ar"
URL_FORM = f"{BASE}/solicitudCertificado"
RE_COD = re.compile(r"/certificado-(?:libre-deuda|ver)-RDAM/([^/?#]+)")
SEXO = {"MASCULINO": "1", "FEMENINO": "2"}
PAUSA_SEG = 3


def log(msg):
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


# ───────────────────────── agentes ─────────────────────────

def traer_agentes(cn, tanda=None, dnis=None):
    sql = ("SELECT p.dni, MIN(t.tanda) AS tanda, MAX(p.apellido) AS apellido, MAX(p.nombre) AS nombre, "
           "MAX(UPPER(s.nombre)) AS sexo "
           "FROM personal p LEFT JOIN tramites_tanda_interinos t ON t.dni = p.dni "
           "LEFT JOIN sexos s ON s.id = p.sexo_id WHERE p.deleted_at IS NULL")
    params = []
    if dnis:
        sql += f" AND p.dni IN ({','.join(['%s'] * len(dnis))})"
        params += dnis
    else:
        sql += " AND t.dni IS NOT NULL"
        if tanda:
            sql += " AND t.tanda = %s"
            params.append(tanda)
    sql += " GROUP BY p.dni ORDER BY MIN(t.tanda), apellido, nombre"
    with cn.cursor() as c:
        c.execute(sql, params)
        filas = c.fetchall()
    if dnis:
        faltan = set(dnis) - {int(f["dni"]) for f in filas}
        for d in sorted(faltan):
            log(f"AVISO: el DNI {d} no está en personal (se saltea)")
    return filas


def nombre_ag(r):
    return f"{(r.get('apellido') or '').strip()}, {(r.get('nombre') or '').strip()}".strip(", ")


def carpeta_destino(dni):
    return DOCU / str(dni) / SUBCARPETA


def ya_tiene(dni):
    d = carpeta_destino(dni)
    return d.is_dir() and any(p.is_file() for p in d.iterdir())


def nombre_archivo(r):
    """APELLIDO NOMBRE RDAM aaaa-mm-dd.pdf (sin caracteres que Windows no acepta)."""
    ap_nom = f"{(r.get('apellido') or '').strip()} {(r.get('nombre') or '').strip()}".upper()
    ap_nom = re.sub(r'[\\/:*?"<>|]+', " ", ap_nom)
    ap_nom = re.sub(r"\s+", " ", ap_nom).strip() or str(r["dni"])
    return f"{ap_nom} RDAM {dt.date.today():%Y-%m-%d}.pdf"


def guardar(r, datos):
    """Guarda el certificado nuevo y recién ahí borra los RDAM viejos de la carpeta (solo los que
    tienen 'RDAM' en el nombre). Devuelve (archivo, cantidad de viejos borrados)."""
    d = carpeta_destino(r["dni"])
    d.mkdir(parents=True, exist_ok=True)
    f = d / nombre_archivo(r)
    tmp = f.with_suffix(".tmp")
    tmp.write_bytes(datos)
    tmp.replace(f)
    borrados = 0
    for viejo in d.iterdir():
        if viejo.is_file() and viejo != f and "RDAM" in viejo.name.upper():
            try:
                viejo.unlink()
                borrados += 1
            except OSError as e:
                log(f"   AVISO: no pude borrar {viejo.name}: {e}")
    return f, borrados


# ───────────────────────── RDAM ─────────────────────────

def cartel(page):
    """Texto del cartel SweetAlert2 visible (y lo cierra), o None."""
    pop = page.locator(".swal2-popup")
    try:
        if pop.count() and pop.first.is_visible():
            t = pop.first.inner_text(timeout=1000).strip().replace("\n", " ")
            page.locator(".swal2-confirm").first.click(timeout=2000)
            return t[:250] or "(cartel sin texto)"
    except Exception:
        pass
    return None


def pedir(page, r, redirects):
    """Completa el formulario y devuelve (codigo, aviso)."""
    page.goto(URL_FORM, wait_until="networkidle", timeout=45000)
    tipo = page.locator('[wire\\:model="tipoId"]')
    if tipo.input_value() != "1":
        tipo.select_option("1")
        page.wait_for_timeout(1500)
    nro = page.locator('[wire\\:model="nroId"]')
    nro.fill(str(r["dni"]))
    nro.press("Tab")
    page.wait_for_timeout(1500)
    page.locator('[wire\\:model="sexoId"]').select_option(SEXO[r["sexo"]])
    page.wait_for_timeout(2500)

    boton = page.locator('main [wire\\:click="buscar()"]')
    redirects.clear()
    boton.click()
    completo_nombre = False
    aviso = None
    for _ in range(60):
        page.wait_for_timeout(500)
        if redirects:
            return redirects[-1], aviso
        ape = page.locator('[wire\\:model="apellido"]')
        if not completo_nombre and ape.count() and ape.is_visible() and not ape.input_value():
            cartel(page)
            ape.fill((r.get("apellido") or "").strip().upper())
            nom = page.locator('[wire\\:model="nombres"]')
            nom.fill((r.get("nombre") or "").strip().upper())
            nom.press("Tab")
            page.wait_for_timeout(1000)
            completo_nombre = True
            boton.click()
            continue
        c = cartel(page)
        if c and not re.search(r"ingresar nombre y apellido", c, re.I):
            aviso = c
    return None, aviso or "El RDAM no generó el certificado"


def leer_resultado(datos):
    """'sin anotaciones' / 'REGISTRA ANOTACIONES' / None según el texto del certificado, + vencimiento."""
    try:
        import io
        import pypdf
        t = " ".join((p.extract_text() or "") for p in pypdf.PdfReader(io.BytesIO(datos)).pages)
    except Exception:
        return None, None
    t = re.sub(r"\s+", " ", t)
    venc = re.search(r"Fecha Vencimiento:\s*(\d{2}/\d{2}/\d{4})", t)
    res = ("sin anotaciones" if re.search(r"\bNO registra anotaciones", t, re.I)
           else "REGISTRA ANOTACIONES" if re.search(r"registra anotaci", t, re.I) else None)
    return res, venc.group(1) if venc else None


def bajar_pdf(ctx, codigo):
    resp = ctx.request.get(f"{BASE}/certificado-libre-deuda-RDAM/{codigo}", timeout=60000)
    if not resp.ok:
        raise Exception(f"El RDAM no entregó el PDF (HTTP {resp.status})")
    datos = resp.body()
    if not datos.startswith(b"%PDF"):
        raise Exception("Lo que devolvió el RDAM no es un PDF")
    return datos


# ───────────────────────── main ─────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tanda")
    ap.add_argument("--dni", help="uno o varios DNIs separados por coma (no hace falta que estén en una tanda)")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--forzar", action="store_true", help="pide aunque la carpeta RDAM ya tenga archivos")
    ap.add_argument("--solo-lista", action="store_true", help="lista los agentes, sin tocar el RDAM")
    ap.add_argument("--headed", action="store_true", help="muestra el navegador")
    args = ap.parse_args()

    dnis = [int(x) for x in re.findall(r"\d{6,9}", args.dni or "")] or None
    with MN.conn() as cn:
        todos = traer_agentes(cn, tanda=args.tanda, dnis=dnis)
    pend = [r for r in todos if args.forzar or not ya_tiene(r["dni"])]
    if args.limit:
        pend = pend[:args.limit]
    log(f"Agentes: {len(todos)}; ya tienen RDAM: {len(todos) - len([r for r in todos if not ya_tiene(r['dni'])])}; "
        f"para procesar: {len(pend)}")
    if args.solo_lista:
        for r in pend:
            log(f"  {r['dni']}  {nombre_ag(r)}  [{r.get('tanda') or '-'}]  sexo {r.get('sexo') or '?'}")
        return 0
    if not pend:
        return 0

    errores = bajados = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(accept_downloads=False)
        page = ctx.new_page()
        redirects = []

        # Livewire redirige al PDF: se toma el código de la respuesta y se corta la navegación.
        def oir(resp):
            if "/livewire/message/" in resp.url and resp.request.method == "POST":
                try:
                    m = RE_COD.search((resp.json().get("effects") or {}).get("redirect") or "")
                    if m:
                        redirects.append(m.group(1))
                except Exception:
                    pass
        page.on("response", oir)
        page.route(re.compile(r".*/certificado-(?:libre-deuda|ver)-RDAM/.*"), lambda route: route.abort())

        for i, r in enumerate(pend):
            log(f"-> {r['dni']} {nombre_ag(r)}")
            if r.get("sexo") not in SEXO or not r.get("apellido") or not r.get("nombre"):
                estado, motivo = "aviso", f"faltan datos en la base (sexo: {r.get('sexo') or '-'})"
            else:
                try:
                    codigo, aviso = pedir(page, r, redirects)
                    if not codigo:
                        estado, motivo = "error", aviso
                    else:
                        datos = bajar_pdf(ctx, codigo)
                        f, borrados = guardar(r, datos)
                        res, venc = leer_resultado(datos)
                        # Deudor alimentario: queda como aviso en la página Robots para que se vea.
                        estado = "aviso" if res == "REGISTRA ANOTACIONES" else "ok"
                        motivo = (f"{res or 'resultado sin leer'} · vence {venc or '?'} · {f.name} (código {codigo})"
                                  + (f" · reemplazó {borrados} viejo(s)" if borrados else "")
                                  + (f" · {aviso}" if aviso else ""))
                except Exception as e:
                    estado, motivo = "error", str(e)[:400]
            log(f"   {estado}: {motivo}")
            MN.registrar_item(SCRIPT_ID, r["dni"], nombre_ag(r), "Certificado RDAM", None, None, estado, motivo)
            errores += estado == "error"
            bajados += estado == "ok" or motivo.startswith("REGISTRA")
            if i < len(pend) - 1:
                time.sleep(PAUSA_SEG)
        browser.close()

    log(f"Listo: {len(pend)} procesado(s), {bajados} bajado(s), {errores} con error.")
    return 1 if errores else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log("Cortado a mano.")
        raise SystemExit(130)
