"""
Circuito de lo que carga el jefe (no titulares), todo como FC. Pedido del usuario 18/10/2026:
se dispara a las 06:00, PRIMERO al Ministerio y DESPUES a SIAPE.

  1. Ministerio (Intranet MS, 34 - FRANCO COMPENSATORIO):
       intranet_carga_art26_v2_hospital / _upa4 / _upa18   (Art. 26)
       intranet_carga_jefe_v2_hospital  / _upa4 / _upa18   (examen, pre-examen, Pap/Colpo, practicas)
  2. SIAPE (FRANCO COMPENSATORIO (COMUNICACIONES)):
       siape_carga_jefe                                     (todo lo anterior, dia por dia)

Si falla un paso se sigue con el resto (son independientes). Cada paso se lanza por
run_robot.py: queda registrado en la pagina Robots y respeta los turnos de Intranet / SIAPE.

Uso: python circuito_jefe.py     (se programa desde la pagina Robots: "Circuito jefe (FC)")
"""
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent

MINISTERIO = [
    "intranet_carga_art26_v2_hospital",
    "intranet_carga_art26_v2_upa4",
    "intranet_carga_art26_v2_upa18",
    "intranet_carga_jefe_v2_hospital",
    "intranet_carga_jefe_v2_upa4",
    "intranet_carga_jefe_v2_upa18",
]
SIAPE = ["siape_carga_jefe"]


def correr(script):
    print(f"==> {script}", flush=True)
    code = subprocess.call([sys.executable, "run_robot.py", script], cwd=SCRIPTS_DIR)
    print(f"<== {script}: {'OK' if code == 0 else f'codigo {code}'}", flush=True)
    return code


def main():
    fallas = [s for s in MINISTERIO + SIAPE if correr(s) != 0]
    print(f"Circuito jefe: {len(MINISTERIO) + len(SIAPE) - len(fallas)}/{len(MINISTERIO) + len(SIAPE)} OK"
          + (f" - con error: {', '.join(fallas)}" if fallas else ""))
    return 1 if fallas else 0


if __name__ == "__main__":
    raise SystemExit(main())
