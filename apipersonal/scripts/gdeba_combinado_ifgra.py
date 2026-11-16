"""
Robot: sube a GDEBA (GEDO) los PDF combinados de "Tramite de nombramiento" como
Informe Gráfico (IFGRA) y los envía a firmar.

Los archivos los elige la pestaña Trámites → 📑 Combinados (DOCU\\<DNI>\\Tramite de nombramiento\\*.pdf);
el pedido queda en app_runtime_config 'gdeba_combinado_ifgra_pedido'
({archivos: ["<dni>/Tramite de nombramiento/<x>.pdf", ...], prueba, firmanteUsuario}).

Por cada archivo:
  Inicio de Documento → IFGRA → Producirlo yo mismo → Referencia
  "TRAMITE DE NOMBRAMIENTO <APELLIDO NOMBRE>" → subir el PDF → Enviar a Firmar →
  usuario firmante (usuario GDEBA exacto) → Aceptar.
OK → estado ENVIADA_FIRMA · falla → ERROR + gdeba_error (sigue con el próximo).

Login, repartición (DPTRH), entrada a GEDO y elección del firmante se reutilizan del
robot de notas de designación (gdeba_nota_designacion.py), ya probados contra GDEBA.

MODO PRUEBA (default): UN archivo, elige el firmante y frena ANTES de Aceptar; deja la
ventana abierta (CDP :9333) y guarda captura + campos en logs/gdeba/. No cambia el estado.

Línea de comando (pisa el pedido):
  python gdeba_combinado_ifgra.py --archivo "<dni>/Tramite de nombramiento/x.pdf" --firmante USUARIO [--real]
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN  # conn() + registrar_run() + registrar_item() + .env
import gdeba_nota_designacion as G  # login / repartición / GEDO / firmante / evidencia

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

SCRIPT_ID = "gdeba_combinado_ifgra"
DESCRIPCION = "Combinados de nombramiento → GDEBA (IFGRA a firmar)"
TIPO_DOC = "IFGRA"
CLAVE_PEDIDO = "gdeba_combinado_ifgra_pedido"  # sync-guard:ignore
SUBCARPETA = "Tramite de nombramiento"
DOCU_BASE = os.environ.get("TRAMITES_DOCU_BASE_DIR") or os.environ.get("DOCUMENTS_SCAN_DIR") or r"D:\G\DOCU"

log = G.log


def leer_pedido(args):
    ped = {}
    try:
        with MN.conn() as cn, cn.cursor() as cur:
            cur.execute("SELECT config_json FROM app_runtime_config WHERE config_key = %s", (CLAVE_PEDIDO,))
            r = cur.fetchone()
            if r and r.get("config_json"):
                ped = r["config_json"] if isinstance(r["config_json"], dict) else json.loads(r["config_json"])
    except Exception as e:
        log(f"AVISO: no pude leer el pedido de la app: {e}")
    if args.archivo:
        ped["archivos"] = args.archivo
    if args.firmante:
        ped["firmanteUsuario"] = args.firmante
    if args.real:
        ped["prueba"] = False
    ped.setdefault("prueba", True)
    ped["firmanteUsuario"] = str(ped.get("firmanteUsuario") or "").strip().upper()
    return ped


def ruta_segura(rel):
    """'<dni>/Tramite de nombramiento/<x>.pdf' → ruta absoluta dentro de DOCU (o error)."""
    partes = [p for p in str(rel).replace("\\", "/").split("/") if p]
    if len(partes) != 3 or not partes[0].isdigit() or partes[1] != SUBCARPETA \
            or not partes[2].lower().endswith(".pdf") or ".." in partes[2]:
        raise RuntimeError(f"Archivo inválido: {rel}")
    base = Path(DOCU_BASE).resolve()
    full = (base / partes[0] / partes[1] / partes[2]).resolve()
    if base not in full.parents:
        raise RuntimeError(f"Ruta fuera de DOCU: {rel}")
    if not full.exists():
        raise RuntimeError(f"El PDF ya no existe: {full}")
    return int(partes[0]), full


def nombre_agente(dni):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("SELECT apellido, nombre FROM personal WHERE dni = %s LIMIT 1", (dni,))
        r = cur.fetchone()
    if not r:
        return f"DNI {dni}"
    return " ".join(f"{r.get('apellido') or ''} {r.get('nombre') or ''}".split()).upper()


def marcar(archivo, dni, estado, firmante=None, error=None):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(
            "INSERT INTO tramites_combinado_gdeba (dni, archivo, estado, firmante, gdeba_error, estado_at, enviada_at) "
            "VALUES (%s, %s, %s, %s, %s, NOW(), IF(%s = 'ENVIADA_FIRMA', NOW(), NULL)) "
            "ON DUPLICATE KEY UPDATE estado = VALUES(estado), firmante = COALESCE(VALUES(firmante), firmante), "
            "gdeba_error = VALUES(gdeba_error), estado_at = NOW(), estado_por = NULL, "
            "enviada_at = IF(VALUES(estado) = 'ENVIADA_FIRMA', NOW(), enviada_at)",
            (dni, archivo, estado, firmante, (error or None) and str(error)[:500], estado))
        cn.commit()


def subir_pdf(page, prod, pdf_path):
    """Sube el PDF en la ventana 'Producir documento' de un tipo importado (IFGRA).
    ZK arma un <input type=file> oculto detrás del botón de subida: primero se prueba
    ese input; si no está, se hace clic en el botón y se atrapa el selector de archivos."""
    for scope in (prod, page):
        inp = scope.locator("input[type=file]")
        if inp.count():
            inp.first.set_input_files(str(pdf_path))
            log(f"PDF subido por el input de archivo ({pdf_path.name}).")
            return
    import re
    patron = re.compile(r"importar|adjuntar|subir|examinar|seleccionar archivo|cargar archivo", re.I)
    btn = prod.get_by_role("button", name=patron)
    if not btn.count():
        raise RuntimeError("No encontré dónde subir el PDF en 'Producir documento' (ver captura)")
    with page.expect_file_chooser(timeout=15000) as fc:
        btn.first.click()
    fc.value.set_files(str(pdf_path))
    log(f"PDF subido por el botón '{btn.first.inner_text().strip()}' ({pdf_path.name}).")


def esperar_subida(page, prod, nombre_pdf):
    """Espera a que GEDO termine de subir el PDF (visto 14/11 con 17,8 MB): mientras sube
    muestra un globo "C:\\fakepath\\<x>.pdf" + barra de progreso y el recuadro sigue diciendo
    "No se ha seleccionado ningún archivo aún"; al terminar el recuadro muestra el nombre
    del archivo con una ✖. Si se aprieta Enviar a Firmar antes, no abre la ventana."""
    nombre = nombre_pdf.lower()
    for _ in range(300):  # hasta 5 min (archivos grandes)
        page.wait_for_timeout(1000)
        err = G.mensaje_error_zk(page)
        if err and any(w in err.lower() for w in ("error", "no se pudo", "inválid", "invalid", "tamaño", "excede")):
            raise RuntimeError(f"GDEBA al subir el PDF: {err}")
        try:
            t = prod.inner_text(timeout=2000).lower()
        except Exception:
            continue
        subiendo = "fakepath" in t or "tamaño del archivo" in t
        if not subiendo and "ningún archivo" not in t and "ningun archivo" not in t and nombre in t:
            return True
    raise RuntimeError("El PDF no terminó de subir a GEDO en 5 minutos")


def un_combinado(page, item, ped):
    dni, pdf_path, nombre = item["dni"], item["path"], item["nombre"]
    referencia = f"TRAMITE DE NOMBRAMIENTO {nombre}"[:250]

    page.get_by_role("button", name="Inicio de Documento").click()
    ventana = page.locator(".z-window").filter(has_text="Iniciar Producción de Documento").first
    ventana.wait_for(timeout=20000)
    tipo = ventana.get_by_role("row").filter(has_text="Documento Electrónico").get_by_role("textbox").first
    tipo.click()
    tipo.fill(TIPO_DOC)
    tipo.press("Tab")
    page.wait_for_timeout(2500)
    txt = G.norm(ventana.inner_text())
    if "GRAFICO" not in txt and "IFGRA" not in txt:
        log("AVISO: no veo 'Informe gráfico' en la descripción del tipo; sigo igual.")
    G.boton(ventana, "Producirlo yo mismo").click()

    prod = page.locator(".z-window").filter(has_text="Producir documento").last
    prod.wait_for(timeout=30000)
    ref = None
    for _ in range(20):
        ref = G.campo_de(page, "Referencia", scope=prod)
        if ref is not None and ref.is_visible():
            break
        page.wait_for_timeout(1000)
    if ref is None:
        raise RuntimeError("No apareció el campo Referencia en 'Producir documento'")
    try:
        ref.fill(referencia, timeout=10000)
    except PWTimeout:
        ref.click(force=True, timeout=5000)
        ref.press_sequentially(referencia, delay=20)
    log("Referencia cargada.")

    subir_pdf(page, prod, pdf_path)
    esperar_subida(page, prod, pdf_path.name)
    log("GEDO terminó de subir el PDF.")

    prod.get_by_role("button", name="Enviar a Firmar").click()
    win = G.elegir_firmante(page, ped["firmanteUsuario"])

    if ped["prueba"]:
        log("MODO PRUEBA: PDF subido y firmante elegido, NO apreto Aceptar.")
        return "prueba"

    win.get_by_role("button", name="Aceptar").click()
    page.wait_for_timeout(3000)
    # OK visto 14/11: cartel "Información — La tarea de firma se envió a PortaFirma." + OK
    err = G.mensaje_error_zk(page)
    if err and "portafirma" in err.lower():
        log(f"GDEBA: {' '.join(err.split())}")
        err = None
    if err and any(w in err.lower() for w in ("error", "debe", "obligatori", "inválid", "invalid", "no se pudo")):
        raise RuntimeError(f"GDEBA: {err}")
    for t in ("OK", "Aceptar"):
        bt = page.get_by_role("button", name=t)
        if bt.count() and bt.first.is_visible():
            bt.first.click()
            break
    page.get_by_role("button", name="Inicio de Documento").wait_for(timeout=60000)
    pd = page.locator(".z-window").filter(has_text="Producir documento")
    if pd.count() and pd.last.is_visible():
        raise RuntimeError("Después de Aceptar sigue abierta 'Producir documento': no sé si se envió")
    return "enviada"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", nargs="*")
    ap.add_argument("--firmante")
    ap.add_argument("--real", action="store_true", help="envía a firmar (sin esto: modo prueba)")
    args = ap.parse_args()
    ped = leer_pedido(args)
    t0 = time.time()

    if not ped["firmanteUsuario"]:
        MN.registrar_run(SCRIPT_ID, DESCRIPCION, "error", motivo="Falta el usuario GDEBA del firmante")
        return 2
    items, malos = [], []
    for rel in (ped.get("archivos") or [])[: 1 if ped["prueba"] else None]:
        try:
            dni, full = ruta_segura(rel)
            items.append({"rel": rel, "dni": dni, "path": full, "nombre": nombre_agente(dni)})
        except Exception as e:
            malos.append((rel, str(e)))
            log(f"Salteo {rel}: {e}")
    modo = "PRUEBA (1 archivo, sin enviar)" if ped["prueba"] else "REAL (envía a firmar)"
    log(f"{len(items)} combinado(s) · firmante {ped['firmanteUsuario']} · modo {modo}")
    if not items:
        MN.registrar_run(SCRIPT_ID, DESCRIPCION, "error" if malos else "ok",
                         motivo=(malos[0][1] if malos else "No hay combinados en el pedido"), filas=0)
        return 2 if malos else 0

    enviadas, errores = 0, 0
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            G.PERFIL, channel="chrome", headless=False, slow_mo=120,
            viewport={"width": 1400, "height": 900},
            args=["--disable-blink-features=AutomationControlled"]
                 + (["--remote-debugging-port=9333"] if ped["prueba"] else []),
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(30000)
        try:
            if not G.esperar_login(page):
                MN.registrar_run(SCRIPT_ID, DESCRIPCION, "error", motivo="Nadie inició sesión en GDEBA en 15 min",
                                 duracion_seg=int(time.time() - t0))
                return 3
            try:
                G.elegir_reparticion(page)
                page = G.entrar_gedo(page)
            except Exception as e:
                msg = str(e).split("\n")[0][:400]
                png = G.evidencia(page, "ifgra_error_entrada")
                log(f"ERROR entrando a GEDO: {msg} (captura {png})")
                MN.registrar_run(SCRIPT_ID, DESCRIPCION, "error", motivo=f"No pude entrar a GEDO: {msg}",
                                 duracion_seg=int(time.time() - t0))
                return 4

            for it in items:
                log(f"── {it['nombre']} (DNI {it['dni']}) · {it['path'].name}")
                try:
                    r = un_combinado(page, it, ped)
                    if r == "prueba":
                        png = G.evidencia(page, f"ifgra_prueba_{it['dni']}")
                        log(f"MODO PRUEBA: frené antes de enviar. Captura: {png}")
                        log(">>> Revisá la ventana. Cuando termines, CERRALA (o cancelá el documento en GDEBA). No se envió nada.")
                        MN.registrar_item(SCRIPT_ID, dni=it["dni"], nombre=it["nombre"], estado="aviso",
                                          detalle="Prueba: IFGRA cargado sin enviar a firmar")
                        try:
                            page.wait_for_event("close", timeout=G.ESPERA_PRUEBA_SEG * 1000)
                        except Exception:
                            pass
                        break
                    marcar(it["rel"], it["dni"], "ENVIADA_FIRMA", firmante=ped["firmanteUsuario"])
                    enviadas += 1
                    G.evidencia(page, f"ifgra_ok_{it['dni']}")
                    MN.registrar_item(SCRIPT_ID, dni=it["dni"], nombre=it["nombre"], estado="ok",
                                      detalle=f"IFGRA enviado a firmar a {ped['firmanteUsuario']}")
                except Exception as e:
                    errores += 1
                    msg = str(e).split("\n")[0][:480]
                    png = G.evidencia(page, f"ifgra_error_{it['dni']}")
                    log(f"ERROR: {msg} (captura {png})")
                    if not ped["prueba"]:
                        marcar(it["rel"], it["dni"], "ERROR", error=msg)
                    MN.registrar_item(SCRIPT_ID, dni=it["dni"], nombre=it["nombre"], estado="error", detalle=msg)
                    if ped["prueba"]:
                        log(">>> PRUEBA con error: dejo la ventana abierta para revisar. Cerrala cuando termines.")
                        try:
                            page.wait_for_event("close", timeout=G.ESPERA_PRUEBA_SEG * 1000)
                        except Exception:
                            pass
                        break
                    try:
                        for t in ("OK", "Cancelar", "Cerrar"):
                            b = page.get_by_role("button", name=t)
                            if b.count() and b.first.is_visible():
                                b.first.click()
                        page.goto(G.URL_GEDO, wait_until="domcontentloaded")
                        page.get_by_role("button", name="Inicio de Documento").wait_for(timeout=60000)
                    except Exception:
                        log("No pude volver a la bandeja de GEDO: corto acá.")
                        break
        finally:
            try:
                ctx.close()
            except Exception:
                pass

    estado = "error" if errores else "ok"
    motivo = (("Prueba: falló la carga del IFGRA (ver capturas en logs/gdeba)" if errores
               else "Prueba: 1 IFGRA cargado sin enviar")
              if ped["prueba"]
              else f"{enviadas} IFGRA enviado(s) a firmar, {errores} con error")
    MN.registrar_run(SCRIPT_ID, DESCRIPCION, estado, motivo=motivo, filas=enviadas, duracion_seg=int(time.time() - t0))
    log(motivo)
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
