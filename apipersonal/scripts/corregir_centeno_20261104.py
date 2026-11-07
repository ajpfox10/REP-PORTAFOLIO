"""CENTENO, TINA DAHIARA ELIZABETH (xxxxxxx, Hospital) — pedido del usuario 04/11/2026:
borrar TODOS sus 28-INASISTENCIA de octubre en la Intranet y cargar E - LICENCIA POR ENFERMEDAD
(PENDIENTE JUSTIFICCION) del 01/10 al 31/12. La E que ya tiene (31/10-02/11) no se toca: se cargan
dos tramos pegados, 01/10-30/10 y 03/11-31/12. Cada 28 borrado queda en logs/28_liberados.csv."""
import csv, os, sys
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN
import cargar_novedades_intranet_v2 as C
import intranet_liberar_28 as L28
from borrar_fc_nocturnos_intranet import leer_historial_con_ids
from playwright.sync_api import sync_playwright

DNI, DEP, PW = xxxxxxx, "HOSPITAL", os.environ.get("INTRANET_PASS")
LABEL_E = C.LABEL_ENF_PENDIENTE
TRAMOS = [("01/10/2026", "30/10/2026"), ("03/11/2026", "31/12/2026")]

def abrir(page):
    ok, msg = C.ir_a_novedades(page, DNI, PW, DEP)
    if not ok:
        raise RuntimeError(msg)

def main():
    with sync_playwright() as p:
        browser, page = C.nueva_pagina(p)
        try:
            C.login(page, PW, DEP)
            abrir(page)
            lista_url = page.url
            filas = [f for f in leer_historial_con_ids(page)
                     if L28._es_28(f["novedad"]) and f.get("delete_href")
                     and not C._sin_acentos(f.get("eliminado") or "NO").upper().startswith("S")
                     and f["desde"].endswith("/10/2026")]
            print(f"28 de octubre a borrar: {[(f['desde'], f['hasta']) for f in filas]}")
            borrados = 0
            for f in filas:
                page.goto(f"{C.BASE_URL}{f['delete_href']}", wait_until="domcontentloaded", timeout=20000)
                page.wait_for_load_state("networkidle", timeout=15000)
                page.goto(lista_url, wait_until="domcontentloaded", timeout=20000)
                page.wait_for_load_state("networkidle", timeout=15000)
                sigue = [x for x in leer_historial_con_ids(page) if x["delete_href"] == f["delete_href"]
                         and not C._sin_acentos(x.get("eliminado") or "NO").upper().startswith("S")]
                if sigue:
                    print(f"  NO se borro {f['desde']}-{f['hasta']}")
                    continue
                borrados += 1
                with open(L28.RESPALDO, "a", newline="", encoding="utf-8-sig") as fh:
                    csv.writer(fh, delimiter=";").writerow([f"{datetime.now():%d/%m/%Y %H:%M}", DNI, f["novedad"], f["desde"], f["hasta"],
                                                            f["delete_href"].split("/")[-2], "CENTENO: reemplazo por E 01/10-31/12 (usuario)"])
                print(f"  borrado 28 {f['desde']}-{f['hasta']}")
            with MN.conn() as cn, cn.cursor() as cur:
                n = cur.execute(f"""UPDATE {C.TABLA_CARGA} SET estado='ELIMINADA',
                        detalle=CONCAT('Eliminada/reemplazada 04/11/2026 (pedido del usuario): va E 01/10-31/12. ', COALESCE(detalle,''))
                        WHERE dni=%s AND novedad_siap='AUSENTE SIN AVISO' AND desde BETWEEN '2026-10-01' AND '2026-12-31'""", (str(DNI),))
                cn.commit()
            print(f"28 borrados: {borrados}/{len(filas)} · cola: {n} ausentes -> ELIMINADA")
            if borrados != len(filas):
                print("No cargo la E: quedaron 28 sin borrar")
                return 1
            for d, h in TRAMOS:
                abrir(page)
                exito, msg = C.cargar_novedad(page, LABEL_E, d, h)
                if not exito:
                    abrir(page)
                    exito = C.ya_cargada_igual(page, LABEL_E, d, h)
                print(f"  {LABEL_E} {d}-{h}: {'OK' if exito else 'ERROR ' + str(msg)}")
        finally:
            try: C.cerrar_sesion(page)
            except Exception: pass
            browser.close()

if __name__ == "__main__":
    raise SystemExit(main())
