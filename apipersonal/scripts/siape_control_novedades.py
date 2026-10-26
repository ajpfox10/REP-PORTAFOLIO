r"""
Control de las novedades de SiAPe contra el mapeo SIAPE -> Ministerio.

En Novedades de Ausentismo, con la ficha de un agente abierta, LEE (no carga nada):
- el selector "Licencia-Permiso" de la pestaña LICENCIAS (boton "...": se abre,
  se leen las filas "Descripcion:" y se cierra con Cancelar);
- los combos de las otras pestañas que traen novedades (TIPO DE AUSENCIA, TIPO de
  comisiones, Permiso / Tipo Ausencia por Hora, Tipo Licencia x Expediente,
  Licencia-Permiso de lactancia). RESOLUCION y PARENTESCO no son novedades.

Con eso mantiene la tabla siape_novedades_catalogo (mig 076): alta de las nuevas,
NUNCA da de baja (lo que no ve solo lo avisa), y avisa las que no tienen fila en
mapeo_novedades (salvo las marcadas no_va_al_ministerio).

Resultado en script_runs / script_run_items (pagina Robots): error SOLO si el robot no
pudo leer (no entro a SiAPe, algun regimen sin leer). Novedades nuevas, desaparecidas o
sin mapear van como aviso: el mapeo es secundario (pedido del usuario, 20/10/2026).

SiAPe ofrece novedades distintas segun el tipo de agente (20/10/2026: con un becado
faltaban las licencias de planta). Abre un agente de cada regimen (BECADOS, RESIDENTES,
10471 PLANTA, 10471 GUARDIA, 10430 TITULAR, 10430 INTERINO), junta todo en el catalogo
y anota que ve cada uno en siape_novedades_regimen (mig 087).

Uso:
    python siape_control_novedades.py
    python siape_control_novedades.py --solo-leer     # no toca la base, imprime lo leido
    python siape_control_novedades.py --regimen BECADOS
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


# Cada tipo de agente ve otras novedades en SiAPe (con un becado faltan las licencias de
# planta, 20/10/2026): se abre un agente de cada regimen y se junta todo.
# (nombre, condicion SQL sobre agentes a / ley l / plantas p)
REGIMENES = [
    ("BECADOS", "a.ley_id IN (6, 7, 8, 9, 10, 12, 13)"),
    ("RESIDENTES", "a.ley_id = 11"),
    ("10471 PLANTA", "a.ley_id = 5"),
    ("10471 GUARDIA", "a.ley_id = 4"),
    ("10430 TITULAR", "a.ley_id IN (1, 3) AND (p.nombre = 'PERMANENTE' OR a.planta_id IS NULL)"),
    ("10430 INTERINO", "a.ley_id IN (1, 3) AND p.nombre IN ('TEMPORARIO/A', 'INTERINO/A')"),
]
CANDIDATOS = 3  # agentes a probar por regimen si SiAPe no encuentra al primero


def _asegurar_tabla_regimen():
    sql = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations",
                            "087__siape_novedades_regimen.sql"), encoding="utf-8").read()
    ddl = sql[sql.index("CREATE TABLE"):].split(";")[0]
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(ddl)
        cn.commit()


def _candidatos(condicion):
    """Agentes activos del regimen. Primero los que el robot de francos ya encontro en SiAPe."""
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(
            "SELECT pe.dni, pe.cuil, CONCAT(pe.apellido, ' ', pe.nombre) AS nombre "
            "FROM agentes a JOIN personal pe ON pe.dni = a.dni "
            "LEFT JOIN plantas p ON p.id = a.planta_id "
            "WHERE a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO' AND " + condicion + " "
            "GROUP BY pe.dni, pe.cuil, pe.apellido, pe.nombre "
            "ORDER BY MAX(EXISTS (SELECT 1 FROM siape_carga_dias s WHERE s.dni = pe.dni "
            "AND s.estado = 'CARGADO')) DESC, RAND() LIMIT %s",
            (CANDIDATOS,),
        )
        return cur.fetchall()


def _entrar():
    F._asegurar_escritorio()
    F.asegurar_sesion()
    F.cerrar_modales()
    if not F._en_ficheros():
        F.abrir_novedades_ausentismo()


def leer_regimen(nombre, condicion, primero):
    """Abre un agente del regimen y devuelve (dni, {origen: set(novedad)})."""
    cands = _candidatos(condicion)
    if not cands:
        raise RuntimeError("no hay agentes activos de este régimen")
    ultimo = None
    for r in cands:
        if not primero:
            F.volver_a_ficheros()
        primero = False
        F.log(f"[{nombre}] abro a {r['nombre']} ({r['dni']})")
        try:
            F.abrir_agente(r)
        except F.AgenteNoEncontrado as e:
            F.log(f"[{nombre}] SiAPe no lo tiene ({e}); pruebo otro")
            ultimo = e
            continue
        except RuntimeError as e:
            # 23/10: Ficheros no refresco la grilla y quedo la fila del agente anterior;
            # no corta el regimen, se prueba con el siguiente
            if "fila vieja" not in str(e):
                raise
            F.log(f"[{nombre}] {e}; pruebo otro")
            ultimo = e
            continue
        leido = leer_combos()
        lov = leer_lov()
        if len(lov) >= MIN_LOV:
            leido[ORIGEN_LOV] = set(lov)
        else:
            F.log(f"AVISO [{nombre}]: el selector Licencia-Permiso trajo {len(lov)} filas: no se usa")
        F.log(f"[{nombre}] " + " · ".join(f"{o}: {len(v)}" for o, v in sorted(leido.items())))
        return r["dni"], leido
    raise RuntimeError(f"SiAPe no encontró a ninguno de {len(cands)} agentes ({ultimo})")


def sincronizar_regimen(regimen, dni, leido):
    """Anota lo que vio el regimen. Devuelve (ahora_la_ve, ya_no_la_ve); vacio la primera vez."""
    ve, deja = [], []
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("SELECT origen, novedad, vigente FROM siape_novedades_regimen WHERE regimen = %s",
                    (regimen,))
        actuales = {(r["origen"], MN.norm(r["novedad"])): r for r in cur.fetchall()}
        primera = not actuales
        for origen, novs in leido.items():
            for n in sorted(novs):
                previo = actuales.get((origen, MN.norm(n)))
                if not primera and (previo is None or not previo["vigente"]):
                    ve.append((origen, n))
                cur.execute(
                    "INSERT INTO siape_novedades_regimen (origen, novedad, regimen, vigente, dni, visto_ultimo) "
                    "VALUES (%s,%s,%s,1,%s,NOW()) ON DUPLICATE KEY UPDATE vigente = 1, dni = VALUES(dni), "
                    "visto_ultimo = NOW()",
                    (origen, n, regimen, dni),
                )
        leidos_norm = {(o, MN.norm(n)) for o, ns in leido.items() for n in ns}
        for (origen, nn), r in actuales.items():
            if origen in leido and r["vigente"] and (origen, nn) not in leidos_norm:
                deja.append((origen, r["novedad"]))  # solo aviso: no se toca vigente
        cn.commit()
    return ve, deja


def sincronizar(leido, completos=None):
    """leido = {origen: set(novedad)}. Devuelve (nuevas, desaparecidas) como [(origen, novedad)].
    completos = origenes leidos en todos los regimenes: solo ahi se dan de baja."""
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
            if (origen in (completos if completos is not None else leido) and r["vigente"]
                    and (origen, nn) not in leidos_norm):
                desaparecidas.append((origen, r["novedad"]))  # solo aviso: no se toca vigente
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
    ap.add_argument("--regimen", help="leer solo este régimen (ej. BECADOS)")
    args = ap.parse_args()
    t0 = time.time()

    # Igual que el robot de francos: con la ventana de SiAPe en (-12,-12) el mouse
    # queda en una esquina y el fail-safe de pyautogui cortaba la corrida.
    if F.pyautogui:
        F.pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE

    regs = [(n, c) for n, c in REGIMENES if not args.regimen or n == args.regimen.upper()]
    if not regs:
        print(f"Régimen desconocido. Opciones: {', '.join(n for n, _c in REGIMENES)}")
        return 2
    if not args.solo_leer:
        _asegurar_tabla_regimen()

    por_regimen, fallas = {}, []
    try:
        _entrar()
    except Exception as e:
        if not args.solo_leer:
            MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error", motivo=f"SiAPe: {e}",
                             duracion_seg=int(time.time() - t0))
        raise
    for i, (nombre, cond) in enumerate(regs):
        try:
            por_regimen[nombre] = leer_regimen(nombre, cond, primero=(i == 0))
        except Exception as e:
            F.log(f"ERROR [{nombre}]: {e}")
            fallas.append((nombre, str(e)))
            try:
                F.cerrar_modales()
            except Exception:
                pass

    # union de todos los regimenes; para dar de baja del catalogo, el origen se tuvo que
    # leer en TODOS (si un regimen fallo, lo que solo ve el no puede darse por desaparecido)
    leido = {}
    for _dni, lr in por_regimen.values():
        for origen, novs in lr.items():
            leido.setdefault(origen, set()).update(novs)
    completos = {o for o in leido
                 if not fallas and not args.regimen and all(o in lr for _d, lr in por_regimen.values())}

    for origen, novs in sorted(leido.items()):
        print(f"{origen}: {len(novs)}")
    for nombre, (dni, lr) in por_regimen.items():
        print(f"  {nombre} ({dni}): " + " · ".join(f"{o} {len(v)}" for o, v in sorted(lr.items())))
        if args.solo_leer:
            for o, v in sorted(lr.items()):
                for n in sorted(v):
                    print(f"     {o} | {n}")
    for nombre, err in fallas:
        print(f"  {nombre}: NO SE PUDO LEER ({err})")
    if args.solo_leer:
        return 0
    if not por_regimen or ORIGEN_LOV not in leido:
        MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error",
                         motivo="No pude leer el selector Licencia-Permiso de ningún régimen"
                                + (f" ({fallas[0][0]}: {fallas[0][1]})" if fallas else ""),
                         duracion_seg=int(time.time() - t0))
        return 1

    nuevas, desaparecidas = sincronizar({o: v for o, v in leido.items()}, completos)
    faltan = sin_mapear()
    for o, n in nuevas:
        MN.registrar_item(SCRIPT_ID, novedad=n, estado="aviso", detalle=f"Novedad NUEVA en SiAPe ({o})")
    for o, n in desaparecidas:
        MN.registrar_item(SCRIPT_ID, novedad=n, estado="aviso", detalle=f"No la vi en ningún régimen ({o})")
    for o, n in faltan:
        MN.registrar_item(SCRIPT_ID, novedad=n, estado="aviso", detalle=f"Sin mapeo al Ministerio ({o})")
    cambios_reg = 0
    for nombre, (dni, lr) in por_regimen.items():
        ve, deja = sincronizar_regimen(nombre, dni, lr)
        cambios_reg += len(ve) + len(deja)
        for o, n in ve:
            MN.registrar_item(SCRIPT_ID, dni=dni, novedad=n, estado="aviso",
                              detalle=f"{nombre} ahora la ve ({o})")
        for o, n in deja:
            MN.registrar_item(SCRIPT_ID, dni=dni, novedad=n, estado="aviso",
                              detalle=f"{nombre} no la vio esta vez ({o})")
    for nombre, err in fallas:
        MN.registrar_item(SCRIPT_ID, novedad=nombre, estado="error", detalle=f"No pude leer el régimen: {err}"[:500])

    total = sum(len(v) for v in leido.values())
    partes = [f"{total} novedades leídas en {len(por_regimen)} régimen(es)"]
    if fallas: partes.append(f"{len(fallas)} régimen(es) sin leer")
    if nuevas: partes.append(f"{len(nuevas)} nuevas")
    if desaparecidas: partes.append(f"{len(desaparecidas)} desaparecidas")
    if cambios_reg: partes.append(f"{cambios_reg} cambios por régimen")
    partes.append(f"{len(faltan)} sin mapear")
    motivo = " · ".join(partes)
    print(motivo)
    # error = el robot no pudo leer (algun regimen); lo del mapeo es solo aviso
    MN.registrar_run(SCRIPT_ID, SCRIPT_DESC, "error" if fallas else "ok", motivo=motivo,
                     filas=total, duracion_seg=int(time.time() - t0))
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
