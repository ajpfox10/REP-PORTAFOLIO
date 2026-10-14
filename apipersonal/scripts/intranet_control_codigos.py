r"""
Control del combo de novedades de la Intranet MS contra el mapeo.

Entra a Parte de Novedades (mismo login y perfil que la carga 2.0), abre la
pantalla de novedades de un agente del plantel y LEE las opciones del combo
"Novedad" (no carga nada). Con eso:

1. Mantiene la tabla ministerio_codigos (mig 074): alta de codigos nuevos,
   texto actualizado si cambio, vigente = 0 para los que desaparecieron.
2. Controla que cada regla de carga de mapeo_novedades (usar_para_cargar = 1)
   apunte a un texto que exista EXACTO en el combo (si no, la carga da
   "Opcion no disponible en este plantel").
3. Informa los codigos del combo que no tienen ninguna novedad SIAPE mapeada.

Resultado en script_runs / script_run_items (pagina Robots): error si hay
codigos nuevos, desaparecidos o reglas de carga rotas; ok si solo hay codigos
sin mapear (van como aviso en el detalle).

Uso:
    python intranet_control_codigos.py
    python intranet_control_codigos.py --dni 12345678      # agente para abrir el combo
"""

import os, sys, argparse, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN
from playwright.sync_api import sync_playwright
import cargar_novedades_intranet_v2 as IV  # login / navegacion de la carga 2.0

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

SCRIPT_ID = "intranet_control_codigos"
SCRIPT_DESC = "Control del combo de novedades de la Intranet vs mapeo"
DEPENDENCIA = "HOSPITAL"
MIN_OPCIONES = 20  # menos que esto = el combo no cargo bien: no se da de baja nada


def dnis_candidatos():
    """Agentes con carga OK reciente en la Intranet (seguro estan en el plantel)."""
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(
            "SELECT dni FROM novedades_carga_intranet WHERE dependencia = %s AND estado = 'OK' "
            "GROUP BY dni ORDER BY MAX(actualizado_en) DESC LIMIT 5",
            (DEPENDENCIA,),
        )
        return [r["dni"] for r in cur.fetchall()]


def leer_combo(page):
    sel = page.locator("select[id*='personalnovedadtype'], select[name*='personalnovedadtype']").first
    try:
        sel.wait_for(timeout=6000)
    except Exception:
        sel = page.locator("select").filter(has_text="Seleccione").first
        sel.wait_for(timeout=6000)
    textos = sel.evaluate("el => Array.from(el.options).map(o => o.text.trim())")
    opciones = {}
    for t in textos:
        if " - " not in t:
            continue  # "Seleccione..."
        cod, resto = t.split(" - ", 1)
        cod = cod.strip().upper()
        opciones[cod] = f"{cod}-{resto.strip()}"
    return opciones


def sincronizar(opciones):
    """Actualiza ministerio_codigos. Devuelve (nuevos, renombrados, desaparecidos)."""
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("SELECT codigo, novedad, vigente FROM ministerio_codigos")
        actuales = {r["codigo"].upper(): r for r in cur.fetchall()}
        nuevos, renombrados, desaparecidos = [], [], []
        for cod, nov in opciones.items():
            previo = actuales.get(cod)
            if previo is None:
                nuevos.append(nov)
            elif MN.norm(previo["novedad"]) != MN.norm(nov):
                renombrados.append((previo["novedad"], nov))
            elif not previo["vigente"]:
                nuevos.append(nov)  # volvio a aparecer
            cur.execute(
                "INSERT INTO ministerio_codigos (codigo, novedad, vigente, visto_ultimo) VALUES (%s,%s,1,NOW()) "
                "ON DUPLICATE KEY UPDATE novedad = VALUES(novedad), vigente = 1, visto_ultimo = NOW()",
                (cod, nov),
            )
        for cod, r in actuales.items():
            if cod not in opciones and r["vigente"]:
                desaparecidos.append(r["novedad"])
                cur.execute("UPDATE ministerio_codigos SET vigente = 0 WHERE codigo = %s", (cod,))
        cn.commit()
    return nuevos, renombrados, desaparecidos


def controlar_mapeo(opciones):
    """(reglas de carga que no estan en el combo, codigos del combo sin ninguna novedad SIAPE)."""
    en_combo = {MN.norm(v) for v in opciones.values()}
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(
            "SELECT novedad_siape, codigo_cie, novedad_ministerio, usar_para_cargar "
            "FROM mapeo_novedades WHERE activo = 1"
        )
        filas = cur.fetchall()
    rotas = [f for f in filas if f["usar_para_cargar"] and MN.norm(f["novedad_ministerio"]) not in en_combo]
    mapeadas = {MN.norm(f["novedad_ministerio"]) for f in filas}
    sin_mapear = [v for v in opciones.values() if MN.norm(v) not in mapeadas]
    return rotas, sorted(sin_mapear)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pass", dest="password")
    parser.add_argument("--dni", help="agente del plantel para abrir el combo")
    args = parser.parse_args()
    password = args.password or os.environ.get("INTRANET_PASS")
    if not password:
        MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error", motivo="Falta INTRANET_PASS en el .env")
        return 1

    t0 = time.time()
    dnis = [args.dni] if args.dni else dnis_candidatos()
    if not dnis:
        MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error",
                         motivo="Sin agente para abrir el combo (no hay cargas OK en novedades_carga_intranet); usar --dni")
        return 1

    opciones, dni_usado, ultimo_error = {}, None, None
    with sync_playwright() as p:
        browser, page = IV.nueva_pagina(p)
        try:
            IV.login(page, password, DEPENDENCIA)
            for dni in dnis:
                ok, msg = IV.ir_a_novedades(page, dni, password, DEPENDENCIA)
                if not ok:
                    ultimo_error = f"DNI {dni}: {msg}"
                    print(f"  {ultimo_error}")
                    continue
                opciones = leer_combo(page)
                if len(opciones) >= MIN_OPCIONES:
                    dni_usado = dni
                    break
                ultimo_error = f"DNI {dni}: el combo trajo solo {len(opciones)} opciones"
                print(f"  {ultimo_error}")
        except Exception as e:
            ultimo_error = f"Intranet: {e}"
        finally:
            try:
                IV.cerrar_sesion(page)
            except Exception:
                pass
            browser.close()

    dur = int(time.time() - t0)
    if not dni_usado:
        MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error", motivo=ultimo_error or "No se pudo leer el combo",
                         duracion_seg=dur)
        return 1

    print(f"Combo leido con DNI {dni_usado}: {len(opciones)} opciones")
    nuevos, renombrados, desaparecidos = sincronizar(opciones)
    rotas, sin_mapear = controlar_mapeo(opciones)

    for n in nuevos:
        MN.registrar_item(SCRIPT_ID, novedad=n, estado="error", detalle="Código NUEVO en el combo de la Intranet: falta mapearlo")
    for viejo, nuevo in renombrados:
        MN.registrar_item(SCRIPT_ID, novedad=nuevo, estado="error", detalle=f"Cambió el texto (antes: {viejo})")
    for d in desaparecidos:
        MN.registrar_item(SCRIPT_ID, novedad=d, estado="error", detalle="Ya NO está en el combo de la Intranet")
    for f in rotas:
        cie = f" (CIE {f['codigo_cie']})" if f["codigo_cie"] else ""
        MN.registrar_item(SCRIPT_ID, novedad=f["novedad_ministerio"], estado="error",
                          detalle=f"Regla de carga de '{f['novedad_siape']}'{cie} apunta a un texto que no está en el combo")
    for s in sin_mapear:
        MN.registrar_item(SCRIPT_ID, novedad=s, estado="aviso", detalle="Sin ninguna novedad SIAPE mapeada")

    problemas = len(nuevos) + len(renombrados) + len(desaparecidos) + len(rotas)
    partes = [f"{len(opciones)} códigos en el combo"]
    if nuevos: partes.append(f"{len(nuevos)} nuevos")
    if renombrados: partes.append(f"{len(renombrados)} con texto cambiado")
    if desaparecidos: partes.append(f"{len(desaparecidos)} desaparecidos")
    if rotas: partes.append(f"{len(rotas)} reglas de carga rotas")
    partes.append(f"{len(sin_mapear)} sin mapear")
    motivo = " · ".join(partes)
    print(motivo)
    MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error" if problemas else "ok", motivo=motivo,
                     filas=len(opciones), duracion_seg=dur)
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
