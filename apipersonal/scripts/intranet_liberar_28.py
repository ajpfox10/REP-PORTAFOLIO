"""
Libera en la Intranet MS los 28-INASISTENCIA que pisan una carga del jefe (04/11/2026, pedido del
usuario: "el robot debe hacerlo automatico, que no pase de nuevo").

Caso: el jefe carga un Art. 26 / examen / novedad para un dia que ya tiene AUSENTE SIN AVISO (en
SIAPE y subido al Ministerio como 28). La carga da "Existe una novedad o licencia cargada que se
superpone". Si TODO lo que se superpone en el rango son 28 sin eliminar, se borran (por el link de
la Intranet), se marcan ELIMINADA en novedades_carga_intranet (el ausente no vuelve a subir) y el
robot reintenta la carga. Si se superpone otra cosa (licencia, accidente...) NO se toca nada.

Lo borrado queda anotado en logs/28_liberados.csv.
"""
import csv
import os
from datetime import datetime, timedelta

import mapeo_novedades as MN
import cargar_novedades_intranet_v2 as C
from borrar_fc_nocturnos_intranet import leer_historial_con_ids

RESPALDO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", "28_liberados.csv")


def _f(ddmmyyyy):
    return datetime.strptime(ddmmyyyy, "%d/%m/%Y").date()


def _es_28(novedad):
    n = C._sin_acentos(novedad or "").upper()
    return n.startswith("28") or "INASISTENCIA" in n


def liberar_28(page, dni, desde, hasta, motivo):
    """En la ficha abierta del agente (pagina /list del historial). desde/hasta dd/mm/aaaa.
    Devuelve (borrados, otros): borrados = cantidad de 28 eliminados; otros = textos de lo que se
    superpone y NO es 28 (si hay algo, no se borra nada)."""
    d0, d1 = _f(desde), _f(hasta)
    lista_url = page.url
    filas = [f for f in leer_historial_con_ids(page)
             if not C._sin_acentos(f.get("eliminado") or "NO").upper().startswith("S")]
    pisan = [f for f in filas if f.get("desde") and f.get("hasta")
             and _f(f["desde"]) <= d1 and _f(f["hasta"]) >= d0]
    otros = [f"{f['novedad']} {f['desde']}-{f['hasta']}" for f in pisan if not _es_28(f["novedad"])]
    a_borrar = [f for f in pisan if _es_28(f["novedad"]) and f.get("delete_href")]
    if otros or not a_borrar:
        return 0, otros
    borrados = 0
    for f in a_borrar:
        page.goto(f"{C.BASE_URL}{f['delete_href']}", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.goto(lista_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_load_state("networkidle", timeout=15000)
        sigue = [x for x in leer_historial_con_ids(page) if x["delete_href"] == f["delete_href"]
                 and not C._sin_acentos(x.get("eliminado") or "NO").upper().startswith("S")]
        if sigue:
            continue
        borrados += 1
        a, b = _f(f["desde"]), _f(f["hasta"])
        with MN.conn() as cn, cn.cursor() as cur:
            cur.execute(f"""UPDATE {C.TABLA_CARGA} SET estado = 'ELIMINADA', detalle = %s
                             WHERE dni = %s AND novedad_siap = 'AUSENTE SIN AVISO' AND desde BETWEEN %s AND %s""",
                        (f"Eliminada en la Intranet {datetime.now():%d/%m/%Y %H:%M}: pisaba {motivo} "
                         f"[{f['delete_href'].split('/')[-2]}]"[:500], str(dni), a, b))
            cn.commit()
        os.makedirs(os.path.dirname(RESPALDO), exist_ok=True)
        nuevo = not os.path.exists(RESPALDO)
        with open(RESPALDO, "a", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh, delimiter=";")
            if nuevo:
                w.writerow(["cuando", "dni", "novedad", "desde", "hasta", "id_intranet", "motivo"])
            w.writerow([f"{datetime.now():%d/%m/%Y %H:%M}", dni, f["novedad"], f["desde"], f["hasta"],
                        f["delete_href"].split("/")[-2], motivo])
        print(f"  28 liberado: {f['novedad']} {f['desde']}-{f['hasta']} (pisaba {motivo})")
    return borrados, []
