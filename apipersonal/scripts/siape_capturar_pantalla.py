"""
Captura READ-ONLY de una pantalla de SiAPe para el catalogo de campos.

Abre (si se pide) la pantalla con las funciones de los robots, recorre el arbol
JAB de la ventana y guarda siape_map_<nombre>.json con el mismo formato que
map_siape_jab.py (id, parent_id, index_in_parent, bounds, text...), que es lo
que lee siape_catalogo.py. No carga ni guarda nada en SiAPe.

Uso:
  python siape_capturar_pantalla.py --nombre tiempo_acumulado --abrir ta
  python siape_capturar_pantalla.py --nombre lo_que_este_abierto          (no navega)
  python siape_capturar_pantalla.py --nombre agente --abrir pestanas_agente --agente "RIBEIRO JONATHAN NATALINO"
      -> busca al agente en Ficheros (solo FILTRAR, no guarda) y captura cada pestana
         de Novedades de Ausentismo en siape_map_agente_<pestana>.json
"""
import argparse
import json
import os
import time
from collections import deque
from pathlib import Path

os.environ.setdefault("SIAPE_CERRAR_AL_FINAL", "false")

import cargar_francos_siape as F
from map_siape_jab import context_id, info_for, iter_children, useful

AQUI = Path(__file__).resolve().parent


def abrir(cual):
    if cual == "ninguna":
        return
    F.asegurar_sesion()
    if cual == "ta":
        import cargar_stress_jab as R
        R.cerrar_modales()
        if not R.abrir_ta():
            raise RuntimeError("No pude abrir Tiempo Acumulado")
    elif cual == "ausentismo":
        F.abrir_novedades_ausentismo()
    elif cual == "menu":
        pass
    else:
        raise ValueError(f"--abrir desconocido: {cual}")
    time.sleep(2)


PESTANAS_AGENTE = ["HORARIO", "LICENCIAS", "CARPETAS", "AUSENCIAS Y PRESENTES", "COMISIONES",
                   "x HORARIO", "x EXPEDIENTE", "SERVICIOS", "COMPENSATORIOS", "LACTANCIA",
                   "EXCEPTUADO", "OBSERVACION"]


def _slug(t):
    return "".join(c if c.isalnum() else "_" for c in t.lower()).strip("_")


def _pestana_activa():
    for _el, _d, info in F._jab_walk(max_depth=16, max_segundos=20):
        if info.get("role") == "page tab" and {"seleccionado", "selected"} & set(info.get("states") or []):
            return (info.get("name") or "").strip()
    return None


def pestanas_agente(nombre, agente):
    F.asegurar_sesion()
    F._buscar_agente_en_ficheros_jab(agente)
    time.sleep(2)
    for tab in PESTANAS_AGENTE:
        F.cerrar_modales()
        if not F._jab_select_tab(tab):
            print(f"{tab}: no pude seleccionarla")
            continue
        time.sleep(2)
        F.cerrar_modales()
        activa = _pestana_activa()
        if activa != tab:
            print(f"{tab}: quedo activa '{activa}', no la guardo")
            continue
        data = capturar()
        out = AQUI / f"siape_map_{nombre}_{_slug(tab)}.json"
        out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{tab}: {out.name} ({data['nodes_saved']} nodos)")


def _guardar(nombre):
    data = capturar()
    out = AQUI / f"siape_map_{nombre}.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out.name}: {data['nodes_saved']} nodos")


def _tabs_visibles(frame_nombre):
    tabs = []
    for _el, _d, info in F._jab_walk(max_depth=30, max_segundos=40):
        if info.get("role") == "page tab" and F._bounds_ok(info):
            n = (info.get("name") or "").strip()
            if n and n not in tabs:
                tabs.append(n)
    return tabs


# pestanas de las que Forms no deja salir sin completar algo -> se visitan al final
PESTANAS_TRAMPA = ("PRESUPUESTO",)


def _recorrer_tabs(prefijo, frame_nombre, abrir_especial=None):
    tabs = _tabs_visibles(frame_nombre)
    tabs = [t for t in tabs if t not in PESTANAS_TRAMPA] + [t for t in tabs if t in PESTANAS_TRAMPA]
    for tab in tabs:
        F.cerrar_modales()
        if abrir_especial and tab in abrir_especial:
            try:
                abrir_especial[tab]()
            except Exception as e:
                print(f"{tab}: {e}")
                continue
        elif not F._jab_select_tab(tab, frame_name=frame_nombre):
            print(f"{tab}: no pude seleccionarla")
            continue
        time.sleep(2)
        F.cerrar_modales()
        if _pestana_activa() != tab:
            print(f"{tab}: no quedo activa, no la guardo")
            continue
        _guardar(f"{prefijo}_{_slug(tab)}")


def exportaciones(nombre):
    """Gestor de Exportaciones (read-only: no exporta)."""
    F.asegurar_sesion()
    import sys
    sys.path.insert(0, str(AQUI / "siape_exportaciones"))
    import descargar_exportacion_siape as X      # el opener del robot real (JAB + teclado)
    fr, _ = X.abrir_gestor_exportaciones()
    if not fr:
        raise RuntimeError("No pude abrir el Gestor de Exportaciones")
    time.sleep(2)
    _guardar(nombre)


# consultas que SIEMPRE abren un dialogo antes de exportar (no se exporta: se cancela)
MODALES_EXPORTAR = {"PERIODO": "Examenes Médicos Salud", "FECHA": "Horario Administrativo a un dia"}


def _cancelar_modal_verificado(X, intentos=4):
    """CANCELAR hasta que no quede ningun dialogo PERIODO/FECHA (el de X corta a los 3s)."""
    for _ in range(intentos):
        if X.esperar_modal(timeout=4) is None:
            return True
        el, info = F._jab_buscar(empieza="CANCELAR", role="push button", timeout=15)
        if info and not (el is not None and X._accion_jab(el)):
            F._jab_click_bounds(info)
        time.sleep(2)
    return X.esperar_modal(timeout=4) is None


def exportar_modales(nombre, solo=None):
    """Dialogos PERIODO y FECHA del Gestor: Exportar -> capturar -> CANCELAR."""
    import sys
    sys.path.insert(0, str(AQUI / "siape_exportaciones"))
    import descargar_exportacion_siape as X
    F.asegurar_sesion()
    if not X.abrir_gestor_exportaciones()[0]:
        raise RuntimeError("No pude abrir el Gestor de Exportaciones")
    for modal, consulta in MODALES_EXPORTAR.items():
        if solo and modal != solo:
            continue
        if not _cancelar_modal_verificado(X):
            raise RuntimeError("Quedo un dialogo de exportar abierto que no puedo cancelar")
        F.cerrar_modales()
        el, info, _aviso = X.fila_consulta(consulta)
        if not info:
            print(f"{modal}: no encuentro la fila '{consulta}'")
            continue
        if not X.seleccionar_fila(el, info, consulta):
            print(f"{modal}: no pude seleccionar la fila")
            continue
        bel, bb = X.boton_exportar_en(info["bounds"]["y"])
        if not bb:
            print(f"{modal}: no encuentro Exportar en la fila")
            continue
        X.clickear_exportar(bel, bb, 1)
        visto = X.esperar_modal(timeout=15)
        if visto != modal:
            print(f"{modal}: aparecio {visto!r}, no lo guardo")
            _cancelar_modal_verificado(X)
            continue
        time.sleep(1.5)
        _guardar(f"{nombre}_{modal.lower()}")
        print(f"{modal}: cancelado={_cancelar_modal_verificado(X)}")


def _frame_top_modal(timeout=20, nombre=None):
    """Internal frame modal/activo mas reciente (los selectores de Forms son modales)."""
    limite = time.time() + timeout
    while time.time() < limite:
        for el, _d, info in F._jab_walk(max_depth=14, max_segundos=15):
            if info.get("role") != "internal frame" or not F._bounds_ok(info):
                continue
            st = set(info.get("states") or [])
            n = (info.get("name") or "").strip()
            if nombre is not None and n == nombre:
                return el, info
            if nombre is None and ("modal" in st or "activo" in st) and n not in ("Novedades de Ausentismo", "Ficheros", "."):
                return el, info
        time.sleep(1)
    return None, None


def _cerrar_sin_elegir(frame_el):
    """Cierra un selector/consulta SIN elegir nada: Cancelar/Salir/Cerrar/Volver; si no hay, Escape."""
    import pyautogui
    for el, _d, info in F._jab_walk(root=frame_el, max_depth=30, max_segundos=20):
        n = (info.get("name") or "").strip().lower()
        if info.get("role") == "push button" and F._bounds_ok(info) and n.startswith(("cancelar", "salir", "cerrar", "volver")):
            try:
                el.click(simulate=False)
            except Exception:
                F._jab_click_bounds(info)
            time.sleep(2)
            F.cerrar_modales()
            return (info.get("name") or "").strip()
    pyautogui.press("escape")
    time.sleep(2)
    return "Escape"


def selectores(nombre, agente):
    F.asegurar_sesion()
    # se importa DESPUES del login: cargar_stress_jab reemplaza el login de F por el
    # suyo (WM_CHAR, un solo intento) y con ese el 07/10 quedo en pantalla desconocida
    import cargar_stress_jab as R
    # 1) selector de licencias de Tiempo Acumulado (robot stress)
    try:
        fr = R.abrir_ta()
        el, _i = R._fila1(fr, 2)
        R._click(el)
        lf = R._find_frame(R.FRAME_LIC, timeout=20)
        if lf:
            time.sleep(1.5)
            _guardar(f"{nombre}_licencias_ta")
            print("   cerrado con:", _cerrar_sin_elegir(lf))
        else:
            print("TA: no abrio Licencias y Permisos")
        R._cerrar_ta()
    except Exception as e:
        print(f"TA: {e}")
    # 2..4) pantalla del agente
    F._buscar_agente_en_ficheros_jab(agente)
    time.sleep(2)
    #   2) selector '...' de la pestana LICENCIAS (robot examen)
    if F._jab_select_tab("LICENCIAS"):
        time.sleep(2)
        fel, _fi = F._jab_find_frame("Novedades de Ausentismo", timeout=10, max_segundos=20)
        btn = None
        for el, _d, i in F._jab_walk(max_depth=30, max_nodes=6000, root=fel, max_segundos=60):
            b = i.get("bounds") or {}
            if (i.get("role") == "push button" and (i.get("name") or "") == "..."
                    and 190 <= b.get("y", 0) <= 215 and b.get("x", 0) > 400):
                btn = el
                break
        if btn:
            btn.click(simulate=False)
            time.sleep(2.5)
            lf, _ = _frame_top_modal()
            if lf:
                _guardar(f"{nombre}_licencias_agente")
                print("   cerrado con:", _cerrar_sin_elegir(lf))
        else:
            print("LICENCIAS: no encuentro el '...'")
    #   3) Calendario (boton CALENDARIO de COMPENSATORIOS)
    if F._jab_select_tab("COMPENSATORIOS"):
        time.sleep(2)
        _el, cal = F._jab_buscar(nombre="CALENDARIO", role="push button", timeout=15)
        if cal:
            F._jab_click_bounds(cal)
            cf, _ = _frame_top_modal(nombre="Calendario")
            if cf:
                time.sleep(1)
                _guardar(f"{nombre}_calendario")
                print("   cerrado con:", _cerrar_sin_elegir(cf))
            else:
                print("Calendario: no abrio")
    #   4) AUDITORIA (boton de la barra)
    _el, aud = F._jab_buscar(nombre="Auditoria", role="push button", timeout=15)
    if aud:
        F._jab_click_bounds(aud)
        af, _ = _frame_top_modal(nombre="AUDITORIA")
        if af:
            time.sleep(1)
            _guardar(f"{nombre}_auditoria")
            print("   cerrado con:", _cerrar_sin_elegir(af))
        else:
            texto, _ = F.leer_dialogo_jab(max_segundos=5)
            print(f"AUDITORIA: no abrio ({texto[:100] if texto else 'sin aviso'})")
            F.cerrar_modales()


def ta_pickers(nombre, dni):
    """Tiempo Acumulado: Buscador de persona + selector Licencias y Permisos con una
    persona en la fila 1. Se cancela el selector y se hace rollback + cierre de TA
    (R._cerrar_ta: 'cancel' y a '¿guardar?' contesta No). No guarda nada."""
    F.asegurar_sesion()
    import cargar_stress_jab as R          # despues del login (ver selectores)
    fr = R.abrir_ta()
    if not fr:
        raise RuntimeError("No pude abrir Tiempo Acumulado")
    original = R._dump_buscador

    def _dump_y_capturar(bf):
        _guardar(f"{nombre}_buscador_persona")
        return original(bf)
    R._dump_buscador = _dump_y_capturar
    try:
        R.buscar_persona(fr, dni)
    finally:
        R._dump_buscador = original
    time.sleep(2)
    _guardar(f"{nombre}_con_persona")
    el, _i = R._fila1(fr, 2)
    R._click(el)
    lf = R._find_frame(R.FRAME_LIC, timeout=20)
    if lf:
        time.sleep(1.5)
        _guardar(f"{nombre}_licencias")
        print("   selector cerrado con:", _cerrar_sin_elegir(lf))
    else:
        texto, _ = F.leer_dialogo_jab(max_segundos=5)
        print(f"Licencias y Permisos no abrio ({texto[:120] if texto else 'sin aviso'})")
    R._cerrar_ta()
    print("   TA cerrado con rollback")


def auditoria(nombre, dni):
    """AUDITORIA (boton de la barra) desde Cargos con el agente cargado. Solo consulta."""
    import cargar_bajas_siape as B
    B.siape_encima(F)
    F.asegurar_sesion()
    B.abrir_cargos(F)
    B.buscar_agente(F, {"dni": dni})
    time.sleep(2)
    _el, aud = F._jab_buscar(nombre="Auditoria", role="push button", timeout=15)
    if not aud:
        raise RuntimeError("No encuentro el boton Auditoria")
    F._jab_click_bounds(aud)
    af, _ = _frame_top_modal(nombre="AUDITORIA", timeout=25)
    if not af:
        texto, _ = F.leer_dialogo_jab(max_segundos=5)
        raise RuntimeError(f"AUDITORIA no abrio ({texto[:120] if texto else 'sin aviso'})")
    time.sleep(1)
    _guardar(nombre)
    print("   cerrado con:", _cerrar_sin_elegir(af))


def cargos(nombre, dni):
    """Cargos y Carrera Administrativa: pantalla vacia, Buscador de Personas,
    agente cargado, cargo actual y cada pestana. NO entra como Supervisor ni guarda."""
    import cargar_bajas_siape as B
    B.siape_encima(F)      # clicks por coordenadas: SiAPe tiene que quedar arriba (como el robot)
    F.asegurar_sesion()
    B.abrir_cargos(F)
    time.sleep(2)
    _guardar(f"{nombre}_inicial")
    original = B._volcar_arbol

    def _volcar_y_capturar(F_, root, archivo):
        if archivo == "buscador_personas.txt":
            _guardar(f"{nombre}_buscador_personas")
        return original(F_, root, archivo)
    B._volcar_arbol = _volcar_y_capturar
    B.buscar_agente(F, {"dni": dni})
    B._volcar_arbol = original
    time.sleep(2)
    _guardar(f"{nombre}_agente")
    # las pestanas se recorren UNA vez, con el cargo actual elegido (abajo)
    F._jab_select_tab("CARGOS", frame_name=B.FRAME_CARGOS)
    time.sleep(2)
    B.elegir_cargo_actual(F)
    time.sleep(2)
    _guardar(f"{nombre}_cargo_actual")
    _recorrer_tabs(f"{nombre}_cargo", B.FRAME_CARGOS, {"BAJA": lambda: B.abrir_pestana_baja(F)})


def capturar(max_depth=40, max_nodes=30000):
    drv = F._jab_driver(forzar=True)
    root = drv.root_element
    rows, seen, claves = [], set(), set()
    queue = deque([(root, 0, None)])
    while queue and len(seen) < max_nodes:
        el, depth, parent_id = queue.popleft()
        try:
            cid = context_id(el)
            if cid in seen:
                continue
            seen.add(cid)
            row = info_for(el, depth, parent_id)
        except Exception:
            continue
        # se guardan TODOS los nodos (el catalogo necesita la cadena de padres)
        key = (row["role"], row["name"], row["description"],
               tuple(sorted((row["bounds"] or {}).items())), row["parent_id"], row["index_in_parent"])
        if key not in claves:
            row["useful"] = useful(row)
            rows.append(row)
            claves.add(key)
        if depth < max_depth:
            for ch in iter_children(el):
                queue.append((ch, depth + 1, row["id"]))
    return {"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "title": F.VENTANA_SIAPE,
            "nodes_seen": len(seen), "nodes_saved": len(rows), "completo": True, "controls": rows}


def main():
    import pyautogui
    pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE   # igual que los robots (mouse en 0,0 sin RDP)
    ap = argparse.ArgumentParser()
    ap.add_argument("--nombre", required=True)
    ap.add_argument("--abrir", default="ninguna", choices=["ninguna", "menu", "ta", "ausentismo", "pestanas_agente",
                                                         "exportaciones", "exportar_modales", "cargos", "selectores", "ta_pickers", "auditoria"])
    ap.add_argument("--agente", default="CICARDI LAUREANO NICOLAS")
    ap.add_argument("--dni", default="34533036")
    ap.add_argument("--modal", choices=["PERIODO", "FECHA"], help="exportar_modales: solo este dialogo")
    a = ap.parse_args()
    if a.abrir == "exportaciones":
        exportaciones(a.nombre)
        return
    if a.abrir == "exportar_modales":
        exportar_modales(a.nombre, a.modal)
        return
    if a.abrir == "auditoria":
        auditoria(a.nombre, a.dni)
        return
    if a.abrir == "ta_pickers":
        ta_pickers(a.nombre, a.dni)
        return
    if a.abrir == "selectores":
        selectores(a.nombre, a.agente)
        return
    if a.abrir == "cargos":
        cargos(a.nombre, a.dni)
        return
    if a.abrir == "pestanas_agente":
        pestanas_agente(a.nombre, a.agente)
        return
    abrir(a.abrir)
    data = capturar()
    out = AQUI / f"siape_map_{a.nombre}.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out.name}: {data['nodes_saved']} nodos")


if __name__ == "__main__":
    main()
