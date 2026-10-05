"""
Despues de cargar en la Intranet: vuelve a bajar el archivo del Ministerio de esa dependencia
y corre el Comparador 2.0 contra el SIAPE, para que la comparacion refleje lo que se cargo
(y confirme contra el Ministerio que lo marcado OK quedo). Lo llaman al terminar los robots de
carga 2.0 (novedades, ausentes, Art. 26), solo si cargaron algo.

Se llama DESPUES de cerrar el navegador del robot (la descarga usa el mismo perfil de Chrome)
y directo, no por run_robot.py: el robot que lo llama ya tiene el turno de la Intranet y si
pidiera otro turno se quedaria esperandose a si mismo.
"""
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent


def actualizar_ministerio_y_comparar(dependencia, cargadas):
    if not cargadas:
        print("Post-carga: no se cargo nada, el archivo del Ministerio no cambia.", flush=True)
        return
    print(f"Post-carga: {cargadas} cargada(s) -> vuelvo a bajar el Ministerio ({dependencia}) y comparo...", flush=True)
    try:
        r = subprocess.run([sys.executable, "descargar_novedades_ministerio.py", "--dependencia", dependencia],
                           cwd=SCRIPTS_DIR, timeout=15 * 60)
        if r.returncode != 0:
            print("Post-carga: no pude bajar el Ministerio; queda la comparacion anterior (la carga ya esta hecha).")
            return
        r = subprocess.run(["node", "comparar_siape_ministerio_v2.mjs"], cwd=SCRIPTS_DIR, timeout=10 * 60)
        print("Post-carga: comparacion nueva lista." if r.returncode == 0
              else "Post-carga: la comparacion fallo; queda la anterior.", flush=True)
    except Exception as e:
        print(f"Post-carga: fallo ({e}); queda la comparacion anterior (la carga ya esta hecha).")
