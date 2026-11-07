"""
borrar_fc_nocturnos_intranet.py  —  Elimina en la Intranet MS los FC (34) que cargo el robot a
agentes de turno nocturno (30/10/2026, en prueba).

Solo toca filas de FRANCO COMPENSATORIO sin eliminar cuyos dias esten TODOS en la cola
novedades_carga_intranet como OK (o sea, cargados por el robot): lo cargado a mano no se toca.
La Intranet borra por link (/personalnovedad/<id>/delete). Lo eliminado queda en la cola como
ELIMINADA para que la carga de novedades no lo vuelva a subir.

Uso:
    python borrar_fc_nocturnos_intranet.py --dni 12345678 --dni 87654321              # simulacion
    python borrar_fc_nocturnos_intranet.py --dni 12345678 --dni 87654321 --confirmar  # borra
    python borrar_fc_nocturnos_intranet.py --nocturnos --confirmar                    # todos los nocturnos
    python borrar_fc_nocturnos_intranet.py --nocturnos --repasar --confirmar          # + los ya ELIMINADA
    python borrar_fc_nocturnos_intranet.py --todos [--confirmar]
        TODOS los FC desde DESDE_MINIMO de todos los agentes con FC en el Ministerio (ultima
        comparacion 2.0, las 3 dependencias), INCLUIDOS los cargados a mano (03/11/2026, pedido
        del usuario). Cada borrado: respaldo en logs/fc_borrados_todos.csv y en la cola queda
        ELIMINADA la fila SIAPE pareada (dni+novedad+desde+hasta) para que no se recargue.
"""
import argparse
import csv
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cargar_novedades_intranet_v2 as C
import mapeo_novedades as MN

DESDE_MINIMO = "2026-10-01"   # septiembre esta cerrado en el Ministerio
# con --repasar tambien se miran los ya marcados ELIMINADA (por si alguno no se borro de verdad)
ESTADOS = ["OK"]
TODOS = False   # --todos: no exige que el FC lo haya cargado el robot
RESPALDO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", "fc_borrados_todos.csv")


def dias_cargados_por_robot(dni):
    """{fecha: id de la cola} de los FC que cargo el robot para el agente."""
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(f"""
            SELECT id, desde, hasta FROM {C.TABLA_CARGA}
             WHERE dni = %s AND estado IN ({",".join(["%s"] * len(ESTADOS))})
               AND novedad_siap LIKE 'FRANCO COMPENSATORIO%%'
               AND label_intranet LIKE '34 -%%' AND desde >= %s""", (str(dni), *ESTADOS, DESDE_MINIMO))
        dias = {}
        for r in cur.fetchall():
            d = r["desde"]
            while d <= r["hasta"]:
                dias[d] = r["id"]
                d += timedelta(days=1)
        return dias


def leer_historial_con_ids(page):
    """Filas del historial con el link de Eliminar (el id de la novedad en la Intranet).
    El historial esta paginado de a 10 ("65 Registros, Pagina 1 de 7"). El boton "siguiente"
    no sirve (la Intranet redirige y vuelve a mostrar la pagina 1): cada pagina se pide por
    ajax (?grid_<hash>[_page]=n con X-Requested-With), que devuelve la grilla de esa pagina."""
    return page.evaluate(r"""async () => {
        const filas = doc => Array.from(doc.querySelectorAll('tr.grid-row-cells')).map(tr => {
            const txt = sel => { const td = tr.querySelector(sel); return td ? td.textContent.trim() : ''; };
            const del = Array.from(tr.querySelectorAll('a')).find(a => /\/delete$/.test(a.getAttribute('href') || ''));
            return {
                novedad: txt('.grid-column-novedad_novedad'),
                desde: txt('.grid-column-fechaDesde'),
                hasta: txt('.grid-column-fechaHasta'),
                eliminado: txt('.grid-column-eliminado'),
                delete_href: del ? del.getAttribute('href') : null,
            };
        });
        const m = document.documentElement.innerHTML.match(/grid_([0-9a-f]{32})_setPage\((\d+)\)/g) || [];
        const hash = (document.documentElement.innerHTML.match(/grid_([0-9a-f]{32})_/) || [])[1];
        if (!hash) return filas(document);
        const paginas = Math.max(1, ...m.map(x => parseInt(x.match(/\((\d+)\)/)[1]) + 1));
        const base = location.href.split('?')[0];
        const out = [];
        for (let n = 0; n < paginas; n++) {
            const r = await fetch(`${base}?grid_${hash}[_page]=${n}`,
                                  {headers: {'X-Requested-With': 'XMLHttpRequest'}, credentials: 'same-origin'});
            if (!r.ok) throw new Error(`pagina ${n + 1} del historial: HTTP ${r.status}`);
            out.push(...filas(new DOMParser().parseFromString(await r.text(), 'text/html')));
        }
        return out;
    }""")


def _fecha(ddmmyyyy):
    return datetime.strptime(ddmmyyyy, "%d/%m/%Y").date()


def candidatos(filas, dias_robot):
    out = []
    for f in filas:
        if "FRANCO COMPENSATORIO" not in C._sin_acentos(f["novedad"]).upper():
            continue
        if C._sin_acentos(f["eliminado"] or "NO").upper().startswith("S") or not f["delete_href"]:
            continue
        d, h = _fecha(f["desde"]), _fecha(f["hasta"])
        dias = [d + timedelta(days=i) for i in range((h - d).days + 1)]
        if TODOS:
            if d.isoformat() >= DESDE_MINIMO:
                f["cola_ids"] = sorted({dias_robot[x] for x in dias if x in dias_robot})
                out.append(f)
        elif all(x in dias_robot for x in dias):
            f["cola_ids"] = sorted({dias_robot[x] for x in dias})
            out.append(f)
    return out


def marcar_eliminada(cola_ids, fila):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(f"""
            UPDATE {C.TABLA_CARGA} SET estado = 'ELIMINADA',
                   detalle = %s
             WHERE id IN ({",".join(["%s"] * len(cola_ids))})""",
            (f"Eliminada en la Intranet (FC turno nocturno) {datetime.now():%d/%m/%Y %H:%M}: "
             f"{fila['desde']} a {fila['hasta']} [{fila['delete_href'].split('/')[-2]}]", *cola_ids))
        cn.commit()


def ultima_corrida():
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("SELECT MAX(id) AS id FROM comparacion_corridas")
        return cur.fetchone()["id"]


def agentes_con_fc_ministerio():
    """{dependencia: [dni]} de todos los agentes con FC en el Ministerio desde DESDE_MINIMO
    (ultima corrida del comparador 2.0)."""
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT dependencia, dni FROM comparacion_novedades
             WHERE corrida_id = %s AND novedad_ministerio LIKE '%%FRANCO COMPENSATORIO%%'
               AND desde_ministerio >= %s AND dni <> ''
             ORDER BY dependencia, dni""", (ultima_corrida(), DESDE_MINIMO))
        por_dep = {}
        for r in cur.fetchall():
            por_dep.setdefault(r["dependencia"], []).append(str(r["dni"]))
        return por_dep


def proteger_de_recarga(dni, dependencia, fila):
    """--todos: la(s) fila(s) SIAPE pareadas con este FC del Ministerio quedan ELIMINADA en la cola
    (se crean si no estaban) para que la carga de novedades no lo vuelva a subir. Respaldo en CSV."""
    d, h = _fecha(fila["desde"]), _fecha(fila["hasta"])
    marca = (f"Eliminada en la Intranet (borrado de todos los FC) {datetime.now():%d/%m/%Y %H:%M}: "
             f"{fila['desde']} a {fila['hasta']} [{fila['delete_href'].split('/')[-2]}]")
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT dependencia, nombre, novedad_siap, desde_siap, hasta_siap, justificado_siap, motivo
              FROM comparacion_novedades
             WHERE corrida_id = %s AND dni = %s AND novedad_siap LIKE 'FRANCO COMPENSATORIO%%'
               AND desde_siap IS NOT NULL AND desde_siap <= %s AND COALESCE(hasta_siap, desde_siap) >= %s""",
            (ultima_corrida(), str(dni), h, d))
        pares = cur.fetchall()
        for r in pares:
            cur.execute(f"""
                INSERT INTO {C.TABLA_CARGA}
                  (dependencia, dni, nombre, novedad_siap, desde, hasta, justificado, motivo_comparacion,
                   corrida_id, estado, detalle)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'ELIMINADA', %s)
                ON DUPLICATE KEY UPDATE estado = 'ELIMINADA', detalle = VALUES(detalle)""",
                (r["dependencia"] or dependencia, str(dni), r["nombre"], r["novedad_siap"], r["desde_siap"],
                 r["hasta_siap"] or r["desde_siap"], r["justificado_siap"], r["motivo"], ultima_corrida(), marca))
        cn.commit()
    nuevo = not os.path.exists(RESPALDO)
    with open(RESPALDO, "a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter=";")
        if nuevo:
            w.writerow(["borrado_en", "dependencia", "dni", "novedad", "desde", "hasta", "id_intranet",
                        "cargado_por_robot", "filas_siape_protegidas"])
        w.writerow([f"{datetime.now():%d/%m/%Y %H:%M:%S}", dependencia, dni, fila["novedad"], fila["desde"],
                    fila["hasta"], fila["delete_href"].split("/")[-2], "SI" if fila["cola_ids"] else "NO",
                    len(pares)])


def agentes_nocturnos_con_fc():
    """{dependencia: [dni]} de los agentes con turno nocturno (horario vigente: entra 17:00 o
    despues y sale pasada la medianoche; 18-00 es vespertino y no entra) que tienen FC cargados
    por el robot desde DESDE_MINIMO."""
    dias = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"]
    cond = " OR ".join(f"({d}_e >= '17:00' AND {d}_s > '00:00' AND {d}_s < {d}_e)" for d in dias)
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("SELECT MAX(fecha) AS f FROM horarios_historial")
        ultima = cur.fetchone()["f"]
        cur.execute(f"SELECT DISTINCT dni FROM horarios_historial WHERE fecha = %s AND ({cond})", (ultima,))
        nocturnos = {str(r["dni"]) for r in cur.fetchall()}
        cur.execute(f"""
            SELECT DISTINCT dependencia, dni FROM {C.TABLA_CARGA}
             WHERE estado IN ({",".join(["%s"] * len(ESTADOS))})
               AND novedad_siap LIKE 'FRANCO COMPENSATORIO%%'
               AND label_intranet LIKE '34 -%%' AND desde >= %s
             ORDER BY dependencia, dni""", (*ESTADOS, DESDE_MINIMO))
        por_dep = {}
        for r in cur.fetchall():
            if r["dni"] in nocturnos:
                por_dep.setdefault(r["dependencia"], []).append(r["dni"])
        return por_dep


def borrar_del_agente(page, dni, password, dependencia, confirmar, totales):
    dias_robot = dias_cargados_por_robot(dni)
    print(f"\nDNI {dni}: {len(dias_robot)} dia(s) de FC cargados por el robot desde {DESDE_MINIMO}")
    ok, msg = C.ir_a_novedades(page, dni, password, dependencia)
    if not ok:
        print(f"  ERROR navegando: {msg}")
        totales["error_nav"] += 1
        return
    lista_url = page.url
    cands = candidatos(leer_historial_con_ids(page), dias_robot)
    if not cands:
        print("  Nada para borrar (ningun FC del robot sin eliminar en la Intranet)")
        return
    for f in cands:
        print(f"  {'Borrando' if confirmar else 'Borraria'}: {f['novedad']} {f['desde']} a {f['hasta']}"
              f"  ({f['delete_href']})")
        if not confirmar:
            totales["a_borrar"] += 1
            continue
        page.goto(f"{C.BASE_URL}{f['delete_href']}", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_load_state("networkidle", timeout=15000)
        aviso = C.exito_visible(page) or C.error_visible(page) or ""
        page.goto(lista_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_load_state("networkidle", timeout=15000)
        sigue = [x for x in leer_historial_con_ids(page)
                 if x["delete_href"] == f["delete_href"]
                 and not C._sin_acentos(x["eliminado"] or "NO").upper().startswith("S")]
        if sigue:
            totales["no_eliminadas"] += 1
            print(f"    NO se elimino (sigue en el historial). Aviso: {aviso}")
        else:
            if f["cola_ids"]:
                marcar_eliminada(f["cola_ids"], f)
            if TODOS:
                proteger_de_recarga(dni, dependencia, f)
            totales["eliminadas"] += 1
            print(f"    OK eliminada. Aviso: {aviso}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dni", action="append")
    parser.add_argument("--nocturnos", action="store_true", help="todos los agentes de turno nocturno")
    parser.add_argument("--dependencia", default="HOSPITAL", help="con --dni")
    parser.add_argument("--confirmar", action="store_true", help="sin esto solo muestra lo que borraria")
    parser.add_argument("--todos", action="store_true",
                        help="TODOS los FC (tambien los cargados a mano) de los agentes con FC en el Ministerio")
    parser.add_argument("--solo-dep", action="append", help="con --todos: solo esa(s) dependencia(s)")
    parser.add_argument("--repasar", action="store_true", help="incluir los ya marcados ELIMINADA en la cola")
    args = parser.parse_args()
    if args.repasar:
        ESTADOS.append("ELIMINADA")
    password = os.environ.get("INTRANET_PASS")
    print("MODO:", "BORRADO REAL" if args.confirmar else "SIMULACION (no borra nada)")
    global TODOS
    TODOS = args.todos
    if args.todos:
        por_dep = agentes_con_fc_ministerio()
        if args.solo_dep:
            por_dep = {d: v for d, v in por_dep.items() if d in args.solo_dep}
    elif args.nocturnos:
        por_dep = agentes_nocturnos_con_fc()
    elif args.dni:
        por_dep = {args.dependencia: args.dni}
    else:
        parser.error("indicar --dni o --nocturnos")
    print("Agentes a revisar: " + " · ".join(f"{d} {len(v)}" for d, v in por_dep.items()))
    totales = {"eliminadas": 0, "no_eliminadas": 0, "a_borrar": 0, "error_nav": 0, "excepciones": 0}

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser, page = C.nueva_pagina(p)
        for dependencia, dnis in por_dep.items():
            C.login(page, password, dependencia)
            print(f"\n=== {dependencia}: {len(dnis)} agente(s)")
            for dni in dnis:
                try:
                    borrar_del_agente(page, dni, password, dependencia, args.confirmar, totales)
                except Exception as e:
                    totales["excepciones"] += 1
                    print(f"  EXCEPCION: {str(e)[:200]}")
        C.cerrar_sesion(page)
        browser.close()
    print("\nRESUMEN: " + " · ".join(f"{k} {v}" for k, v in totales.items()))


if __name__ == "__main__":
    main()
