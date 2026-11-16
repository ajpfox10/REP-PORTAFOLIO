"""
Robot: baja de GDEBA (GEDO) los IFGRA de "Tramite de nombramiento" ya firmados y los
guarda junto al combinado:
  DOCU\\<DNI>\\Tramite de nombramiento\\<combinado> - FIRMADO <IF-...>.pdf

Fuente: GEDO → Mis Tareas → Avisos (lista de lo que mandé a firmar, ordenada por fecha).
Cada fila trae Firmante, Motivo (FIRMADO / RECHAZADO ...), Referencia, Número GDEBA y un
ícono "Descargar el documento final". La Referencia se ve cortada a 20 caracteres pero el
<td> tiene la referencia completa en su `title` (visto 14/11) → se compara contra
"TRAMITE DE NOMBRAMIENTO <APELLIDO NOMBRE>" (la que pone gdeba_combinado_ifgra.py).

Por cada combinado en ENVIADA_FIRMA (o los del pedido):
  FIRMADO   → baja el PDF, estado FIRMADA + gdeba_numero + archivo_firmado + firmada_at
  RECHAZADO → estado ERROR ("Rechazado en GDEBA por <firmante>") para relanzarlo
  no está   → queda ENVIADA_FIRMA (todavía no lo firmaron: no es error)

Es solo lectura en GDEBA (descargar no cambia nada allá), así que no tiene modo prueba.
Pedido opcional en app_runtime_config 'gdeba_combinado_firmados_pedido' ({archivos?}).
"""
import argparse
import json
import os
import sys
import time
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN
import gdeba_nota_designacion as G

from playwright.sync_api import sync_playwright

SCRIPT_ID = "gdeba_combinado_firmados"
DESCRIPCION = "Combinados de nombramiento ← GDEBA (bajar firmados)"
CLAVE_PEDIDO = "gdeba_combinado_firmados_pedido"  # sync-guard:ignore
SUBCARPETA = "Tramite de nombramiento"
DOCU_BASE = os.environ.get("TRAMITES_DOCU_BASE_DIR") or os.environ.get("DOCUMENTS_SCAN_DIR") or r"D:\G\DOCU"
MAX_PAGINAS = 30          # Avisos: 10 por página, de lo más nuevo a lo más viejo
MARGEN_DIAS = 3           # se deja de paginar al pasar (envío más viejo - margen)

log = G.log


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return " ".join(s.upper().replace(",", " ").split())


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
    return ped


def pendientes(archivos):
    sql = ("SELECT c.id, c.dni, c.archivo, c.enviada_at, p.apellido, p.nombre "
           "FROM tramites_combinado_gdeba c LEFT JOIN personal p ON p.dni = c.dni "
           "WHERE c.estado = 'ENVIADA_FIRMA'")
    params = []
    if archivos:
        sql += " AND c.archivo IN (" + ",".join(["%s"] * len(archivos)) + ")"
        params += list(archivos)
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    out = []
    for r in rows:
        nombre = " ".join(f"{r.get('apellido') or ''} {r.get('nombre') or ''}".split()).upper() or f"DNI {r['dni']}"
        out.append({**r, "nombre": nombre, "ref": norm(f"TRAMITE DE NOMBRAMIENTO {nombre}")})
    return out


def guardar_firmado(item, numero, origen_tmp):
    base = Path(DOCU_BASE).resolve()
    partes = item["archivo"].split("/")
    destino_dir = (base / partes[0] / partes[1]).resolve()
    if base not in destino_dir.parents:
        raise RuntimeError(f"Ruta fuera de DOCU: {item['archivo']}")
    stem = Path(partes[2]).stem
    destino = destino_dir / f"{stem} - FIRMADO {numero}.pdf"
    destino_dir.mkdir(parents=True, exist_ok=True)
    origen_tmp.save_as(str(destino))  # pisa si ya existía
    if destino.stat().st_size < 1000 or destino.read_bytes()[:5] != b"%PDF-":
        raise RuntimeError(f"Lo bajado no es un PDF válido ({destino.name})")
    return destino, f"{partes[0]}/{partes[1]}/{destino.name}"


def marcar(item, estado, numero=None, archivo_firmado=None, error=None):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(
            "UPDATE tramites_combinado_gdeba SET estado = %s, gdeba_numero = COALESCE(%s, gdeba_numero), "
            "archivo_firmado = COALESCE(%s, archivo_firmado), gdeba_error = %s, estado_at = NOW(), estado_por = NULL, "
            "firmada_at = IF(%s = 'FIRMADA', NOW(), firmada_at) WHERE id = %s",
            (estado, numero, archivo_firmado, (error or None) and str(error)[:500], estado, item["id"]))
        cn.commit()


def ir_a_avisos(page):
    page.get_by_text("Mis Tareas", exact=True).first.click()
    page.wait_for_timeout(3000)
    lb = page.locator(".z-listbox").filter(has_text="Número GDEBA").first
    lb.wait_for(timeout=30000)
    return lb


def filas_avisos(lb):
    """[(idx, firmante, motivo, referencia_completa, fecha_envio, numero)] de la página visible."""
    return lb.evaluate(r"""l => [...l.querySelectorAll('tr.z-listitem')].map((r, i) => {
        const td = [...r.querySelectorAll('td.z-listcell')];
        // la referencia completa está en el title del <td> (el texto se corta a 20 caracteres);
        // en Firmante el title es un tooltip ("Haga click aquí...") → texto visible.
        const t = k => td[k] ? (td[k].getAttribute('title') || td[k].innerText || '').trim() : '';
        const v = k => td[k] ? (td[k].innerText || '').trim() : '';
        return {i, firmante: v(1), motivo: v(3), ref: t(4), envio: v(5), numero: v(7)};
    })""")


def pagina_siguiente(page):
    """Click en ▶ del paginado de Avisos (el que acompaña a la lista con 'Número GDEBA')."""
    pid = page.evaluate(r"""() => {
        const lb = [...document.querySelectorAll('.z-listbox')].find(l => l.offsetParent && /Número GDEBA/.test(l.innerText));
        if (!lb) return null;
        const cont = lb.parentElement.parentElement;
        const pg = [...cont.querySelectorAll('.z-paging')].find(p => p.offsetParent);
        return pg ? pg.id : null;
    }""")
    if not pid:
        return False
    nxt = page.locator(f"#{pid} .z-paging-next").first
    if not nxt.count() or "disd" in (nxt.get_attribute("class") or "") or nxt.get_attribute("disabled"):
        return False
    nxt.click()
    page.wait_for_timeout(2500)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", nargs="*")
    args = ap.parse_args()
    ped = leer_pedido(args)
    t0 = time.time()

    items = pendientes(ped.get("archivos"))
    log(f"{len(items)} combinado(s) enviados a firmar para buscar en GDEBA.")
    if not items:
        MN.registrar_run(SCRIPT_ID, DESCRIPCION, "ok", motivo="No hay combinados enviados a firmar", filas=0)
        return 0
    fechas = [i["enviada_at"] for i in items if i.get("enviada_at")]
    corte = (min(fechas) - timedelta(days=MARGEN_DIAS)) if fechas else None

    bajados, rechazados = 0, 0
    por_ref = {i["ref"]: i for i in items}
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            G.PERFIL, channel="chrome", headless=False, slow_mo=80, accept_downloads=True,
            viewport={"width": 1400, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
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
                lb = ir_a_avisos(page)
            except Exception as e:
                msg = str(e).split("\n")[0][:400]
                G.evidencia(page, "firmados_error_entrada")
                MN.registrar_run(SCRIPT_ID, DESCRIPCION, "error", motivo=f"No pude entrar a Avisos de GEDO: {msg}",
                                 duracion_seg=int(time.time() - t0))
                return 4

            for nro_pag in range(1, MAX_PAGINAS + 1):
                filas = filas_avisos(lb)
                for f in filas:
                    it = por_ref.get(norm(f["ref"]))
                    if not it:
                        continue
                    motivo = norm(f["motivo"])
                    if motivo == "FIRMADO" and f["numero"]:
                        try:
                            fila = lb.locator("tr.z-listitem").nth(f["i"])
                            with page.expect_download(timeout=90000) as dl:
                                fila.locator("span.z-icon-download").first.click()
                            destino, rel = guardar_firmado(it, f["numero"].strip(), dl.value)
                            marcar(it, "FIRMADA", numero=f["numero"].strip(), archivo_firmado=rel)
                            bajados += 1
                            log(f"FIRMADO {it['nombre']} → {f['numero']} · {destino.name}")
                            MN.registrar_item(SCRIPT_ID, dni=it["dni"], nombre=it["nombre"], estado="ok",
                                              detalle=f"Firmado {f['numero']} por {f['firmante']}")
                        except Exception as e:
                            msg = str(e).split("\n")[0][:400]
                            log(f"ERROR bajando {it['nombre']}: {msg}")
                            MN.registrar_item(SCRIPT_ID, dni=it["dni"], nombre=it["nombre"], estado="error", detalle=msg)
                            continue
                    elif "RECHAZ" in motivo:
                        marcar(it, "ERROR", error=f"Rechazado en GDEBA por {f['firmante']}")
                        rechazados += 1
                        log(f"RECHAZADO {it['nombre']} por {f['firmante']}")
                        MN.registrar_item(SCRIPT_ID, dni=it["dni"], nombre=it["nombre"], estado="error",
                                          detalle=f"Rechazado por {f['firmante']}")
                    else:
                        log(f"{it['nombre']}: aviso con motivo '{f['motivo']}' (sigo buscando)")
                        continue
                    por_ref.pop(it["ref"], None)
                if not por_ref:
                    break
                # cortar cuando la página ya es más vieja que el envío más viejo buscado
                envios = []
                for f in filas:
                    try:
                        envios.append(datetime.strptime(f["envio"][:16], "%Y-%m-%d %H:%M"))
                    except Exception:
                        pass
                if corte and envios and max(envios) < corte:
                    log(f"Página {nro_pag}: ya es anterior a {corte:%d/%m/%Y}; dejo de buscar.")
                    break
                if not pagina_siguiente(page):
                    break
                lb = page.locator(".z-listbox").filter(has_text="Número GDEBA").first
        finally:
            try:
                ctx.close()
            except Exception:
                pass

    for it in por_ref.values():
        log(f"Sin firmar todavía: {it['nombre']}")
        MN.registrar_item(SCRIPT_ID, dni=it["dni"], nombre=it["nombre"], estado="aviso", detalle="Todavía no firmado")
    motivo = f"{bajados} firmado(s) bajado(s), {rechazados} rechazado(s), {len(por_ref)} sin firmar todavía"
    MN.registrar_run(SCRIPT_ID, DESCRIPCION, "ok", motivo=motivo, filas=bajados, duracion_seg=int(time.time() - t0))
    log(motivo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
