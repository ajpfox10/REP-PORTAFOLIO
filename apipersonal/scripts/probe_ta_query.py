# -*- coding: utf-8 -*-
"""READ-ONLY: abre TA, ubica el campo 'Apellido y Nombre' (consulta), tipea un
apellido, ejecuta la consulta y vuelca la grilla (filas por Y). NO edita nada
(solo consulta). Para mapear como leer/ubicar la fila 2025 a corregir."""
import sys, time
import cargar_francos_siape as F
import cargar_stress_jab as R
from cargar_francos_siape import log

APELLIDO = sys.argv[1] if len(sys.argv) > 1 else "PEVERI"


def dump_grilla(fr):
    log(f"   --- grilla (text con bounds) ---")
    rows = []
    for el, d, info in F._jab_walk(root=fr, max_depth=22, max_segundos=45):
        if (info.get("role") or "") != "text":
            continue
        nom = (info.get("name") or "").strip()
        val = (F._jab_read_text(el) or "").strip()
        b = info.get("bounds") or {}
        rows.append((b.get('y'), b.get('x'), nom, val))
    rows.sort(key=lambda r: (r[0] if r[0] is not None else 9999, r[1] if r[1] is not None else 9999))
    for y, x, nom, val in rows:
        if nom in ("Año", "Licencia / Permiso", "Apellido y Nombre") or "Día" in nom or "Ley" in nom:
            log(f"   y={y} x={x} | col='{nom}' | val='{val}'")


def main():
    F.asegurar_sesion(); R.cerrar_modales()
    fr = R.abrir_ta()
    if not fr:
        log("No abri TA"); return
    R.cerrar_modales()
    # buscar el campo de consulta 'Apellido y Nombre' (text editable arriba)
    campo = None
    for el, d, info in F._jab_walk(root=fr, max_depth=20, max_segundos=25):
        if (info.get("role") or "") not in ("text",):
            continue
        nom = (info.get("name") or "").strip()
        b = info.get("bounds") or {}
        # el campo de consulta esta arriba (y chico) y su name suele ser 'Apellido y Nombre'
        if nom.upper().startswith("APELLIDO Y NOMBRE") and (b.get('y') or 999) < 220:
            campo = el; log(f"   campo consulta: name='{nom}' y={b.get('y')} x={b.get('x')}"); break
    if not campo:
        log("   no ubique 'Apellido y Nombre' por name<220; vuelco text arriba:")
        for el, d, info in F._jab_walk(root=fr, max_depth=20, max_segundos=20):
            if (info.get("role") or "") != "text":
                continue
            b = info.get("bounds") or {}
            if (b.get('y') or 999) < 220:
                log(f"      y={b.get('y')} x={b.get('x')} name='{(info.get('name') or '').strip()}'")
        return
    R._frente_liviano()
    try:
        campo.request_focus()
    except Exception:
        pass
    R._click(campo, simulate=True)
    time.sleep(0.3)
    R._wm_type(APELLIDO)
    time.sleep(0.4)
    log(f"   tipeo '{APELLIDO}' + ejecuto consulta (Re Query)")
    rq, _ = F._jab_buscar(nombre="Re Query", role="push button", timeout=6)
    if rq:
        R._click(rq)
    else:
        R._wm_key(0x77, 0x41)   # F8 fallback
    time.sleep(2.0)
    R.cerrar_modales()
    fr = R._find_frame(R.FRAME_TA, timeout=8) or fr
    dump_grilla(fr)
    log("   (no edito nada) cierro TA")
    try:
        R._recuperar()
    except Exception:
        R.cerrar_modales()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        log(f"ERROR: {e}")
        for l in traceback.format_exc().splitlines():
            log(f"   {l}")
