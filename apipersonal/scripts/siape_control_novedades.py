r"""
Control de las novedades de SiAPe contra el mapeo SIAPE -> Ministerio.

En Novedades de Ausentismo, con la ficha de un agente abierta, LEE (no carga nada):
- el selector "Licencia-Permiso" de la pestaña LICENCIAS (boton "...": se abre,
  se leen las filas "Descripcion:" y se cierra con Cancelar);
- los combos de las otras pestañas que traen novedades (TIPO DE AUSENCIA, TIPO de
  comisiones, Permiso / Tipo Ausencia por Hora, Tipo Licencia x Expediente,
  Licencia-Permiso de lactancia). RESOLUCION y PARENTESCO no son novedades.

Con eso mantiene la tabla siape_novedades_catalogo (mig 076): alta de las nuevas,
vigente = 0 para las que desaparecieron, y avisa las que no tienen fila en
mapeo_novedades (salvo las marcadas no_va_al_ministerio).

Resultado en script_runs / script_run_items (pagina Robots): error si aparecieron o
desaparecieron novedades; ok con aviso si solo hay sin mapear.

Si SiAPe ya esta en la ficha de un agente la usa; si no, entra y abre el agente de
SIAPE_CONTROL_DNI (o el ultimo con un franco cargado por el robot).

Uso:
    python siape_control_novedades.py
    python siape_control_novedades.py --solo-leer     # no toca la base, imprime lo leido
"""

import os, sys, time, argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN
import cargar_francos_siape as F

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

SCRIPT_ID = "siape_control_novedades"
SCRIPT_DESC = "Control de novedades de SiAPe vs mapeo"

# combo (description JAB) -> origen en la tabla
COMBOS = {
    "TIPO DE AUSENCIA": "AUSENCIAS Y PRESENTES",
    "TIPO": "COMISIONES",
    "Permiso": "POR HORA",
    "Tipo Ausencia por Hora": "POR HORA",
    "Tipo Licencia x Expediente": "x EXPEDIENTE",
    "Licencia-Permiso": "LACTANCIA",
}
ORIGEN_LOV = "LICENCIAS"
MIN_LOV = 15  # menos filas = el selector no cargo bien: no se da de baja nada


def _nombre(info):
    return (info.get("name") or "").strip()


def leer_combos():
    """{origen: set(opciones)} leyendo los label hijos de cada combo (no se abren)."""
    combos = []
    for el, _d, info in F._jab_walk(max_depth=30, max_nodes=20000, max_segundos=120):
        if info.get("role") == "combo box":
            desc = (info.get("description") or _nombre(info)).strip()
            if desc in COMBOS:
                combos.append((el, info, desc))
    out = {}
    for el, info, desc in combos:
        propio = _nombre(info)
        for _e, _d, sub in F._jab_walk(max_depth=4, root=el, max_segundos=25):
            n = _nombre(sub)
            if sub.get("role") == "label" and n and n != propio:
                out.setdefault(COMBOS[desc], set()).add(n)
    return out


def _lov_filas():
    filas = []
    for _el, _d, info in F._jab_walk(max_depth=30, max_nodes=20000, max_segundos=90):
        n = _nombre(info)
        if info.get("role") == "label" and n.startswith("Descripcion:"):
            filas.append(n.split(":", 1)[1].strip())
    return filas


def _boton_lov():
    """El '...' a la derecha del campo editable Licencia-Permiso de la pestaña LICENCIAS."""
    campo, boton = None, []
    for _el, _d, info in F._jab_walk(max_depth=30, max_nodes=20000, max_segundos=90):
        b = info.get("bounds") or {}
        if b.get("x", -1) < 0:
            continue
        estados = [e.lower() for e in (info.get("states") or [])]
        if (info.get("role") == "text" and _nombre(info) == "Licencia-Permiso"
                and "editable" in estados):
            campo = info
        if info.get("role") == "push button" and _nombre(info) == "...":
            boton.append(info)
    if campo:
        cb = campo["bounds"]
        for info in boton:
            b = info["bounds"]
            if abs(b["y"] - cb["y"]) <= 4 and 0 <= b["x"] - (cb["x"] + cb["width"]) <= 40:
                return info
    # El campo a veces no aparece en el arbol (13/10: tras cambiar de pestaña). Los '...'
    # de la cabecera (legajo / apellido) estan arriba de y=180; el de la pestaña es el
    # unico visible dentro del cuerpo de la pestaña (encima de la fila de pestañas).
    cuerpo = [i for i in boton if 180 <= i["bounds"]["y"] < 500]
    return cuerpo[0] if len(cuerpo) == 1 else None


def leer_lov():
    """Filas del selector Licencia-Permiso. Si ya esta abierto lo usa; lo cierra con Cancelar."""
    filas = _lov_filas()
    abri = False
    if not filas:
        if not F._jab_select_tab(ORIGEN_LOV):
            raise RuntimeError("No pude ir a la pestaña LICENCIAS")
        btn = _boton_lov()
        if not btn:
            raise RuntimeError("No encontré el '...' de Licencia-Permiso")
        F._jab_click_bounds(btn)
        abri = True
        for _ in range(10):
            time.sleep(F.PAUSA_MEDIA)
            filas = _lov_filas()
            if filas:
                break
        # JAB solo expone las filas que ya se dibujaron (13/10: 9 de 39 al abrir; con la
        # lista recorrida a mano salian todas). Se baja con flecha (en el selector de Forms
        # la flecha mueve la marca de la lista sin elegir) y se junta hasta que no aparecen
        # filas nuevas dos veces seguidas. No se acepta nada: despues va Cancelar.
        import pyautogui
        vistas = list(dict.fromkeys(filas))
        sin_nuevas = 0
        for _ in range(40):
            if sin_nuevas >= 2:
                break
            F._activar_ventana(F._buscar_ventana_siape())
            pyautogui.press("down", presses=8, interval=0.08)
            time.sleep(F.PAUSA_MEDIA)
            antes = len(vistas)
            for f in _lov_filas():
                if f not in vistas:
                    vistas.append(f)
            sin_nuevas = sin_nuevas + 1 if len(vistas) == antes else 0
        filas = vistas
    # Cancelar: no elige nada (el registro queda como estaba)
    cancelar, _info = F._jab_buscar(nombre="Cancelar ALT C", role="push button", timeout=10)
    if cancelar is not None:
        F._jab_click_element(cancelar)
    elif abri:
        import pyautogui
        pyautogui.press("esc")
    time.sleep(F.PAUSA_MEDIA)
    F.cerrar_modales()
    return filas


def _hay_ficha():
    _el, info = F._jab_buscar(nombre="Licencia-Permiso", role="text", timeout=15)
    return info is not None


def _agente_para_abrir():
    dni = os.environ.get("SIAPE_CONTROL_DNI", "").strip()
    with MN.conn() as cn, cn.cursor() as cur:
        if not dni:
            cur.execute("SELECT dni FROM siape_carga_dias WHERE estado = 'CARGADO' "
                        "ORDER BY id DESC LIMIT 1")
            r = cur.fetchone()
            dni = r["dni"] if r else None
        if not dni:
            return None
        cur.execute("SELECT dni, cuil, CONCAT(apellido, ' ', nombre) AS nombre FROM personal WHERE dni = %s",
                    (dni,))
        return cur.fetchone()


def abrir_ficha():
    if _hay_ficha():
        F.log("SiAPe ya está en la ficha de un agente: la uso")
        return
    r = _agente_para_abrir()
    if not r:
        raise RuntimeError("Sin agente para abrir (SIAPE_CONTROL_DNI vacío y sin francos cargados)")
    F._asegurar_escritorio()
    F.asegurar_sesion()
    F.cerrar_modales()
    if not F._en_ficheros():
        F.abrir_novedades_ausentismo()
    F.abrir_agente(r)


def sincronizar(leido):
    """leido = {origen: set(novedad)}. Devuelve (nuevas, desaparecidas) como [(origen, novedad)]."""
    nuevas, desaparecidas = [], []
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("SELECT origen, novedad, vigente FROM siape_novedades_catalogo")
        actuales = {(r["origen"], MN.norm(r["novedad"])): r for r in cur.fetchall()}
        for origen, novs in leido.items():
            for n in sorted(novs):
                previo = actuales.get((origen, MN.norm(n)))
                if previo is None or not previo["vigente"]:
                    nuevas.append((origen, n))
                cur.execute(
                    "INSERT INTO siape_novedades_catalogo (origen, novedad, vigente, visto_ultimo) "
                    "VALUES (%s,%s,1,NOW()) ON DUPLICATE KEY UPDATE vigente = 1, visto_ultimo = NOW()",
                    (origen, n),
                )
        leidos_norm = {(o, MN.norm(n)) for o, ns in leido.items() for n in ns}
        for (origen, nn), r in actuales.items():
            # solo se dan de baja las de los origenes que se pudieron leer
            if origen in leido and r["vigente"] and (origen, nn) not in leidos_norm:
                desaparecidas.append((origen, r["novedad"]))
                cur.execute("UPDATE siape_novedades_catalogo SET vigente = 0 WHERE origen = %s AND novedad = %s",
                            (origen, r["novedad"]))
        cn.commit()
    return nuevas, desaparecidas


def sin_mapear():
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("SELECT DISTINCT novedad_siape FROM mapeo_novedades WHERE activo = 1")
        mapeadas = {MN.norm(r["novedad_siape"]) for r in cur.fetchall()}
        cur.execute("SELECT origen, novedad FROM siape_novedades_catalogo "
                    "WHERE vigente = 1 AND no_va_al_ministerio = 0 ORDER BY origen, novedad")
        return [(r["origen"], r["novedad"]) for r in cur.fetchall() if MN.norm(r["novedad"]) not in mapeadas]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo-leer", action="store_true")
    args = ap.parse_args()
    t0 = time.time()

    try:
        abrir_ficha()
        leido = leer_combos()
        lov = leer_lov()
        if len(lov) >= MIN_LOV:
            leido[ORIGEN_LOV] = set(lov)
        else:
            F.log(f"AVISO: el selector Licencia-Permiso trajo {len(lov)} filas: no se usa")
    except Exception as e:
        if not args.solo_leer:
            MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error", motivo=f"SiAPe: {e}",
                             duracion_seg=int(time.time() - t0))
        raise

    for origen, novs in sorted(leido.items()):
        print(f"{origen}: {len(novs)}")
        if args.solo_leer:
            for n in sorted(novs):
                print(f"   {n}")
    if args.solo_leer:
        return 0
    if ORIGEN_LOV not in leido:
        MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error", motivo="No pude leer el selector Licencia-Permiso",
                         duracion_seg=int(time.time() - t0))
        return 1

    nuevas, desaparecidas = sincronizar(leido)
    faltan = sin_mapear()
    for o, n in nuevas:
        MN.registrar_item(SCRIPT_ID, novedad=n, estado="error", detalle=f"Novedad NUEVA en SiAPe ({o})")
    for o, n in desaparecidas:
        MN.registrar_item(SCRIPT_ID, novedad=n, estado="error", detalle=f"Ya NO está en SiAPe ({o})")
    for o, n in faltan:
        MN.registrar_item(SCRIPT_ID, novedad=n, estado="aviso", detalle=f"Sin mapeo al Ministerio ({o})")

    total = sum(len(v) for v in leido.values())
    partes = [f"{total} novedades leídas"]
    if nuevas: partes.append(f"{len(nuevas)} nuevas")
    if desaparecidas: partes.append(f"{len(desaparecidas)} desaparecidas")
    partes.append(f"{len(faltan)} sin mapear")
    motivo = " · ".join(partes)
    print(motivo)
    problemas = len(nuevas) + len(desaparecidas)
    MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error" if problemas else "ok", motivo=motivo,
                     filas=total, duracion_seg=int(time.time() - t0))
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
