"""
corregir_licencias_e_intranet.py  —  Cambia en la Intranet MS la "E - LICENCIA POR ENFERMEDAD
(PENDIENTE JUSTIFICCIÓN)" por el código que corresponde cuando la licencia ya quedó OTORGADA en
SIAPE (05/11/2026, pedido del usuario).

Regla:
  - SIAPE PENDIENTE / DENEGADA / OBSERVADA / ... (todo lo que no sea OTORGADA/APROBADA ni
    JUSTIFICADO=SI)  -> la E está bien, NO se toca.
  - SIAPE OTORGADA/APROBADA -> se borra la E (por el link de la Intranet) y se carga lo que sale
    del mapeo (mapeo_novedades: 01 / 05 / 1R* por CIE), con las fechas de la licencia.

Solo se toca una E si TODO su rango está cubierto por licencias ya otorgadas del agente (si una
parte sigue pendiente, la E queda). Si después de borrar la E la carga nueva falla, se vuelve a
cargar la E en ese tramo para no dejar el día vacío.

Fuentes: LICENCIAS_MEDICAS.xlsx (export SIAPE) + ministerio_novedades_anual (lo que hay en la
Intranet, para elegir a quién mirar; en la Intranet se verifica de nuevo en el historial).
Respaldo de cada cambio: logs/licencias_e_corregidas.csv.

Uso:
    python corregir_licencias_e_intranet.py                       # simulación (no toca nada)
    python corregir_licencias_e_intranet.py --confirmar           # corrige de verdad
    python corregir_licencias_e_intranet.py --dni 12345678 [--confirmar]
    python corregir_licencias_e_intranet.py --solo-dep HOSPITAL [--confirmar]
"""
import argparse
import csv
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pandas as pd
import cargar_novedades_intranet_v2 as C
import mapeo_novedades as MN
from borrar_fc_nocturnos_intranet import leer_historial_con_ids

SCRIPT_ID = "intranet_corregir_licencias_e"
SCRIPT_DESC = "Intranet: E pendiente -> código real cuando SIAPE otorgó la licencia"
DESDE_MINIMO = date(2026, 10, 1)   # septiembre y antes: meses cerrados en el Ministerio
RESUELTAS = {"OTORGADA", "APROBADA"}
RESPALDO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", "licencias_e_corregidas.csv")


def _d(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return pd.to_datetime(v, dayfirst=True).date()
    except Exception:
        return None


def ddmm(d):
    return d.strftime("%d/%m/%Y")


def es_e(novedad):
    n = C._sin_acentos(novedad or "").upper().strip()
    return n.startswith("E-") or n.startswith("E -") or "PENDIENTE JUSTIFIC" in n


def leer_licencias():
    """{dni: [dict(novedad, desde, hasta, resuelta, resolucion)]} del LICENCIAS_MEDICAS.xlsx."""
    out = defaultdict(list)
    df = pd.read_excel(MN.LICENCIAS_PATH)
    for _, r in df.iterrows():
        try:
            dni = int(r["NRO_DOCUMENTO"])
        except Exception:
            continue
        d1, d2 = _d(r.get("FECHA_DESDE")), _d(r.get("FECHA_HASTA")) or _d(r.get("FECHA_DESDE"))
        if not d1 or not d2:
            continue
        res = str(r.get("RESOLUCION", "") or "").strip().upper()
        just = str(r.get("JUSTIFICADO", "") or "").strip().upper()
        out[dni].append({
            "novedad": str(r.get("NOVEDAD", "") or "").strip().upper(),
            "desde": d1, "hasta": d2, "resolucion": res,
            "resuelta": res in RESUELTAS or just == "SI",
        })
    return out


def e_del_ministerio(dnis_filtro=None, deps=None):
    """{dependencia: {dni: [(desde, hasta)]}} de las E del Ministerio (última descarga)."""
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("""
            SELECT m.dependencia, CAST(m.dni AS CHAR) AS dni, m.fecha_desde AS d,
                   COALESCE(m.fecha_hasta, m.fecha_desde) AS h
              FROM ministerio_novedades_anual m
             WHERE m.codigo = 'E' AND m.fecha_desde >= %s
               AND EXISTS (SELECT 1 FROM agentes a WHERE a.dni = m.dni AND a.deleted_at IS NULL)
             ORDER BY m.dependencia, m.dni, m.fecha_desde""", (DESDE_MINIMO,))
        filas = cur.fetchall()
    out = defaultdict(lambda: defaultdict(list))
    for f in filas:
        if dnis_filtro and f["dni"] not in dnis_filtro:
            continue
        if deps and f["dependencia"] not in deps:
            continue
        out[f["dependencia"]][int(f["dni"])].append((f["d"], f["h"]))
    return out


def plan_para_e(dni, e1, e2, lics, mapa, licencias_mn):
    """Lista de tramos [(label, desde, hasta, novedad_siape)] que reemplazan a la E [e1, e2], o
    (None, motivo) si no corresponde tocarla."""
    pisan = [l for l in lics if l["desde"] <= e2 and l["hasta"] >= e1]
    if not pisan:
        return None, "sin licencia en SIAPE para esas fechas"
    pend = [l for l in pisan if not l["resuelta"]]
    if pend:
        return None, "sigue " + "/".join(sorted({l["resolucion"] or "?" for l in pend})) + " en SIAPE (la E está bien)"
    tramos = []
    for l in sorted(pisan, key=lambda x: x["desde"]):
        a, b = max(l["desde"], e1), min(l["hasta"], e2)
        label, _cie, _por_cie = MN.elegir_label(mapa, licencias_mn, dni, l["novedad"], l["desde"], l["hasta"])
        if not label:
            return None, f"sin mapeo para '{l['novedad']}'"
        if C._sin_acentos(label).upper().startswith("E"):
            return None, "el mapeo también da E"
        tramos.append([label, a, b, l["novedad"]])
    # el rango de la E tiene que quedar cubierto entero, sin huecos
    cursor = e1
    for t in tramos:
        if t[1] > cursor:
            return None, f"hueco sin licencia otorgada el {ddmm(cursor)}"
        cursor = max(cursor, t[2] + timedelta(days=1))
    if cursor <= e2:
        return None, f"hueco sin licencia otorgada el {ddmm(cursor)}"
    # juntar tramos seguidos con la misma novedad
    juntos = []
    for t in tramos:
        if juntos and juntos[-1][0] == t[0] and t[1] <= juntos[-1][2] + timedelta(days=1):
            juntos[-1][2] = max(juntos[-1][2], t[2])
        else:
            juntos.append(list(t))
    return juntos, None


def respaldo(fila):
    os.makedirs(os.path.dirname(RESPALDO), exist_ok=True)
    nuevo = not os.path.exists(RESPALDO)
    with open(RESPALDO, "a", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh, delimiter=";")
        if nuevo:
            w.writerow(["cuando", "dependencia", "dni", "e_desde", "e_hasta", "id_intranet", "accion", "detalle"])
        w.writerow([f"{datetime.now():%d/%m/%Y %H:%M}", *fila])


def anotar_cola(dni, novedad_siape, desde, hasta, label, detalle):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(f"""UPDATE {C.TABLA_CARGA} SET label_intranet = %s, detalle = %s
                         WHERE dni = %s AND novedad_siap = %s AND desde <= %s AND hasta >= %s""",
                    (label[:200], detalle[:500], str(dni), novedad_siape, hasta, desde))
        cn.commit()


def volver(page, url):
    page.goto(url, wait_until="domcontentloaded", timeout=20000)
    page.wait_for_load_state("networkidle", timeout=15000)


def corregir_agente(page, password, dependencia, dni, es_db, lics, mapa, licencias_mn, confirmar, tot):
    # planes a partir de lo que dice la base; después se verifica contra el historial real
    planes = []
    for e1, e2 in es_db:
        tramos, motivo = plan_para_e(dni, e1, e2, lics, mapa, licencias_mn)
        if tramos:
            planes.append((e1, e2, tramos))
        else:
            tot["sin_cambio"] += 1
            print(f"  DNI {dni} E {ddmm(e1)}-{ddmm(e2)}: no se toca ({motivo})")
    if not planes:
        return
    if not confirmar:
        for e1, e2, tramos in planes:
            tot["a_corregir"] += 1
            print(f"  DNI {dni} E {ddmm(e1)}-{ddmm(e2)} -> " +
                  " + ".join(f"{t[0]} {ddmm(t[1])}-{ddmm(t[2])}" for t in tramos))
            MN.registrar_item(SCRIPT_ID, dni, None, "E -> " + tramos[0][0], ddmm(e1), ddmm(e2), "aviso",
                              "simulación: se corregiría")
        return

    ok, msg = C.ir_a_novedades(page, dni, password, dependencia)
    if not ok:
        tot["error_nav"] += 1
        print(f"  DNI {dni}: ERROR navegando: {msg}")
        MN.registrar_item(SCRIPT_ID, dni, None, "E", None, None, "error", f"navegación: {msg}")
        return
    lista_url = page.url
    hist = [f for f in leer_historial_con_ids(page)
            if not C._sin_acentos(f.get("eliminado") or "NO").upper().startswith("S")]

    for e1, e2, tramos in planes:
        fila = next((f for f in hist if es_e(f["novedad"]) and f.get("delete_href")
                     and f["desde"] == ddmm(e1) and f["hasta"] == ddmm(e2)), None)
        etiqueta = f"E {ddmm(e1)}-{ddmm(e2)}"
        if not fila:
            tot["no_encontrada"] += 1
            print(f"  DNI {dni} {etiqueta}: no está en el historial (ya corregida o cambió)")
            continue
        id_intra = fila["delete_href"].split("/")[-2]
        print(f"  DNI {dni} {etiqueta}: borrando [{id_intra}] y cargando " +
              " + ".join(f"{t[0]} {ddmm(t[1])}-{ddmm(t[2])}" for t in tramos))
        try:
            corregir_una_e(page, dependencia, dni, e1, e2, fila, id_intra, tramos, lista_url, tot)
        except Exception as ex:
            # 05/11/2026: un timeout después de borrar dejó un día vacío (GUERRERO 27/10). Se reabre el
            # agente y se completa lo que falte según el historial real.
            print(f"    EXCEPCIÓN a mitad ({str(ex)[:120]}): reviso el historial y completo")
            tot["recuperadas"] += 1
            ok_n, msg_n = C.ir_a_novedades(page, dni, password, dependencia)
            if not ok_n:
                raise RuntimeError(f"no pude reabrir el agente tras la excepción: {msg_n}") from ex
            asegurar_tramos(page, dependencia, dni, e1, e2, id_intra, tramos, page.url, tot)


def vigentes(page):
    return [f for f in leer_historial_con_ids(page)
            if not C._sin_acentos(f.get("eliminado") or "NO").upper().startswith("S")]


def asegurar_tramos(page, dependencia, dni, e1, e2, id_intra, tramos, lista_url, tot):
    """Después de una excepción: si la E sigue vigente no se toca nada; si no, cada tramo sin
    novedad vigente que lo cubra se carga (o se repone la E si la carga falla)."""
    hist = vigentes(page)
    if any(es_e(f["novedad"]) and f["desde"] == ddmm(e1) and f["hasta"] == ddmm(e2) for f in hist):
        print("    la E sigue vigente: queda como estaba (se corrige en la próxima corrida)")
        return
    respaldo([dependencia, dni, ddmm(e1), ddmm(e2), id_intra, "E_BORRADA", "(verificada tras excepción)"])
    for label, a, b, nov_siape in tramos:
        cubierto = any(f.get("desde") and f.get("hasta") and _d(f["desde"]) <= a and _d(f["hasta"]) >= b
                       for f in hist)
        if cubierto:
            print(f"    {ddmm(a)}-{ddmm(b)} ya tiene novedad vigente")
            continue
        cargar_tramo(page, dependencia, dni, e1, e2, id_intra, label, a, b, nov_siape, lista_url, tot)


def cargar_tramo(page, dependencia, dni, e1, e2, id_intra, label, a, b, nov_siape, lista_url, tot):
    ok_c, msg_c = C.cargar_novedad(page, label, ddmm(a), ddmm(b))
    volver(page, lista_url)
    if ok_c:
        tot["corregidas"] += 1
        det = f"E corregida a {label} en la Intranet {datetime.now():%d/%m/%Y %H:%M} (SIAPE otorgó)"
        print(f"    OK {label} {ddmm(a)}-{ddmm(b)}")
        respaldo([dependencia, dni, ddmm(e1), ddmm(e2), id_intra, "CARGADA", f"{label} {ddmm(a)}-{ddmm(b)}"])
        anotar_cola(dni, nov_siape, a, b, label, det)
        MN.registrar_item(SCRIPT_ID, dni, None, f"E -> {label}", ddmm(a), ddmm(b), "ok", msg_c)
        return
    # falló: se repone la E en ese tramo para no dejarlo vacío
    tot["fallidas"] += 1
    ok_r, msg_r = C.cargar_novedad(page, C.LABEL_ENF_PENDIENTE, ddmm(a), ddmm(b))
    volver(page, lista_url)
    estado_r = "E repuesta" if ok_r else f"NO SE PUDO REPONER LA E ({msg_r})"
    print(f"    FALLÓ {label} {ddmm(a)}-{ddmm(b)}: {msg_c} -> {estado_r}")
    respaldo([dependencia, dni, ddmm(e1), ddmm(e2), id_intra, "FALLO", f"{label}: {msg_c} · {estado_r}"])
    MN.registrar_item(SCRIPT_ID, dni, None, f"E -> {label}", ddmm(a), ddmm(b), "error", f"{msg_c} · {estado_r}")
    if not ok_r:
        tot["sin_reponer"] += 1


def corregir_una_e(page, dependencia, dni, e1, e2, fila, id_intra, tramos, lista_url, tot):
    page.goto(f"{C.BASE_URL}{fila['delete_href']}", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_load_state("networkidle", timeout=15000)
    volver(page, lista_url)
    sigue = [x for x in vigentes(page) if x["delete_href"] == fila["delete_href"]]
    if sigue:
        tot["no_eliminadas"] += 1
        print("    NO se eliminó la E (sigue en el historial): no se carga nada")
        MN.registrar_item(SCRIPT_ID, dni, None, "E", ddmm(e1), ddmm(e2), "error", "la Intranet no eliminó la E")
        return
    respaldo([dependencia, dni, ddmm(e1), ddmm(e2), id_intra, "E_BORRADA", ""])
    for label, a, b, nov_siape in tramos:
        cargar_tramo(page, dependencia, dni, e1, e2, id_intra, label, a, b, nov_siape, lista_url, tot)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirmar", action="store_true", help="sin esto solo muestra lo que haría")
    ap.add_argument("--dni", action="append")
    ap.add_argument("--solo-dep", action="append", help="HOSPITAL / UPA 4 / UPA 18")
    ap.add_argument("--pass", dest="password")
    args = ap.parse_args()
    t0 = time.time()
    password = args.password or os.environ.get("INTRANET_PASS")
    print("MODO:", "CORRECCIÓN REAL" if args.confirmar else "SIMULACIÓN (no toca la Intranet)")

    lics = leer_licencias()
    mapa = MN.cargar_mapa_carga()
    licencias_mn = MN.cargar_licencias()
    por_dep = e_del_ministerio(set(args.dni) if args.dni else None,
                               [d.upper() for d in args.solo_dep] if args.solo_dep else None)
    print("E en el Ministerio desde " + ddmm(DESDE_MINIMO) + ": " +
          " · ".join(f"{d} {sum(len(v) for v in x.values())}" for d, x in por_dep.items()))
    tot = defaultdict(int)

    def candidatos(dnis):
        return [dni for dni, es in dnis.items()
                if any(plan_para_e(dni, a, b, lics.get(dni, []), mapa, licencias_mn)[0] for a, b in es)]

    try:
        if not args.confirmar:
            for dep, dnis in por_dep.items():
                print(f"\n=== {dep}")
                for dni, es in dnis.items():
                    corregir_agente(None, password, dep, dni, es, lics.get(dni, []), mapa, licencias_mn, False, tot)
        else:
            if not password:
                raise RuntimeError("Falta INTRANET_PASS")
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser, page = C.nueva_pagina(p)
                for dep, dnis in por_dep.items():
                    cands = candidatos(dnis)
                    print(f"\n=== {dep}: {len(cands)} agente(s) con E para corregir")
                    if not cands:
                        continue
                    C.login(page, password, dep)
                    for dni in cands:
                        try:
                            corregir_agente(page, password, dep, dni, dnis[dni], lics.get(dni, []),
                                            mapa, licencias_mn, True, tot)
                        except Exception as e:
                            tot["excepciones"] += 1
                            print(f"  DNI {dni} EXCEPCIÓN: {str(e)[:200]}")
                            MN.registrar_item(SCRIPT_ID, dni, None, "E", None, None, "error", str(e)[:500])
                    C.cerrar_sesion(page)
                browser.close()
    except Exception as e:
        print(f"ERROR: {e}")
        MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error", motivo=str(e)[:500], duracion_seg=int(time.time() - t0))
        return

    resumen = " · ".join(f"{k} {v}" for k, v in sorted(tot.items()))
    print("\nRESUMEN: " + (resumen or "nada"))
    estado = "error" if tot["sin_reponer"] or tot["excepciones"] else "ok"
    MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, estado,
                     motivo=("SIMULACIÓN · " if not args.confirmar else "") + (resumen or "sin E para corregir"),
                     filas=tot["corregidas"] or tot["a_corregir"], archivo=RESPALDO,
                     duracion_seg=int(time.time() - t0))


if __name__ == "__main__":
    main()
