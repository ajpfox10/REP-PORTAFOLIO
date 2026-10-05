"""Prueba: abre SiAPe como un robot (pre-login + asegurar_sesion) y sale SIN cerrarlo:
lo tiene que cerrar solo el atexit de cargar_francos_siape.
  --dejar-abierto  -> SIAPE_CERRAR_AL_FINAL=false (para probar la limpieza de run_robot)"""
import os
import sys

if "--dejar-abierto" in sys.argv:
    os.environ["SIAPE_CERRAR_AL_FINAL"] = "false"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cargar_francos_siape as F
import cargar_stress_jab as R

R.pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE
if not F._buscar_ventana_siape():
    R._pre_login_sin_jab()
F.asegurar_sesion()
F.log(f"Abierto: pids SiAPe = {sorted(F._pids_siape())}. Salgo sin cerrarlo.")
