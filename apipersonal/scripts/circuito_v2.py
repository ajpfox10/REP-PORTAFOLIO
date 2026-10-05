"""
Circuito 2.0: corre en orden, uno atras del otro, los robots de la version 2.0:
  1. siape_novedades_por_periodo                (baja SIAPE\\SIAPE.xlsx)
  2. intranet_descarga_novedades / _upa4 / _upa18 (baja MINISTERIO\\MINISTERIO.xls, UPA4.xls, UPA18.xls)
  3. FRENO: si fallo alguna descarga o algun archivo no se actualizo en esta corrida,
     corta aca: no compara ni carga nada (nunca cargar sobre datos viejos).
  4. comparacion_siape_ministerio_v2            (compara y guarda en tablas)
  5. intranet_carga_novedades_v2_hospital / _upa4 / _upa18
     intranet_carga_ausentes_v2_hospital  / _upa4 / _upa18
  6. intranet_carga_art26_v2_hospital / _upa4 / _upa18  (Art. 26 como FC; no depende de las
     descargas: corre aunque el freno haya cortado)
  7. siape_horario_admin_dia                    (no lo usa el circuito: si falla no frena nada)
  8. VERIFICACION: vuelve a bajar el Ministerio x3 y compara de nuevo, para que la pagina quede
     al dia y confirmar contra el Ministerio que lo marcado OK quedo cargado (lo que no aparezca
     vuelve a salir como "solo SIAPE"). Solo si hubo cargas; si falla no cambia nada.

Cada paso se lanza por run_robot.py (queda registrado en la pagina Robots y respeta los
turnos). Si la comparacion falla NO se carga nada. Si falla la carga de una dependencia,
se sigue con las demas.

Uso: python circuito_v2.py     (se programa desde la pagina Robots: "Circuito 2.0")
     python circuito_v2.py --sin-art26   (todo menos la carga de Art. 26)
"""
import os
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
BASE_DIR = Path(os.environ.get("LICENCIAS_PDF_DIR") or r"D:\G\comparacion")

# (robot, archivo que tiene que quedar actualizado)
DESCARGAS = [
    ("siape_novedades_por_periodo", BASE_DIR / "SIAPE" / "SIAPE.xlsx"),
    ("intranet_descarga_novedades", BASE_DIR / "MINISTERIO" / "MINISTERIO.xls"),
    ("intranet_descarga_novedades_upa4", BASE_DIR / "MINISTERIO" / "UPA4.xls"),
    ("intranet_descarga_novedades_upa18", BASE_DIR / "MINISTERIO" / "UPA18.xls"),
]
COMPARAR = "comparacion_siape_ministerio_v2"
CARGAS = [
    "intranet_carga_novedades_v2_hospital",
    "intranet_carga_novedades_v2_upa4",
    "intranet_carga_novedades_v2_upa18",
    "intranet_carga_ausentes_v2_hospital",
    "intranet_carga_ausentes_v2_upa4",
    "intranet_carga_ausentes_v2_upa18",
]
# no dependen de las descargas ni de la comparacion: corren siempre y no frenan nada
AL_FINAL = [
    "intranet_carga_art26_v2_hospital",
    "intranet_carga_art26_v2_upa4",
    "intranet_carga_art26_v2_upa18",
    "siape_horario_admin_dia",
]


def correr(script):
    print(f"==> {script}", flush=True)
    code = subprocess.call([sys.executable, "run_robot.py", script], cwd=SCRIPTS_DIR)
    print(f"<== {script}: {'OK' if code == 0 else f'codigo {code}'}", flush=True)
    return code


def actualizado(archivo, desde):
    """El archivo existe y se escribio despues de arrancar el circuito."""
    try:
        return archivo.stat().st_mtime >= desde
    except OSError:
        return False


def main():
    inicio = time.time()
    al_final = [s for s in AL_FINAL if not ("--sin-art26" in sys.argv and "art26" in s)]

    # 1-2. descargas (se corren todas aunque falle una: el freno decide despues)
    problemas = []
    for script, archivo in DESCARGAS:
        if correr(script) != 0:
            problemas.append(f"{script} fallo")
        elif not actualizado(archivo, inicio):
            problemas.append(f"{script} no actualizo {archivo.name}")

    # 3. freno
    if problemas:
        print("FRENO: no comparo ni cargo nada (datos viejos). " + "; ".join(problemas))
        for script in al_final:
            correr(script)
        return 1

    # 4. comparacion
    if correr(COMPARAR) != 0:
        print("La comparacion fallo: no cargo nada.")
        for script in al_final:
            correr(script)
        return 1

    # 5. cargas
    fallas = [s for s in CARGAS if correr(s) != 0]
    print(f"Circuito 2.0: {len(CARGAS) - len(fallas)}/{len(CARGAS)} cargas OK"
          + (f" - con error: {', '.join(fallas)}" if fallas else ""))

    # 6-7. Art. 26 + extras que no frenan
    for script in al_final:
        correr(script)

    # 8. verificacion: Ministerio actualizado + comparacion nueva despues de cargar
    print("Verificacion: vuelvo a bajar el Ministerio y comparo de nuevo...", flush=True)
    inicio_verif = time.time()
    ok_verif = all(correr(script) == 0 and actualizado(archivo, inicio_verif)
                   for script, archivo in DESCARGAS if script.startswith("intranet_descarga"))
    if ok_verif and correr(COMPARAR) == 0:
        print("Verificacion OK: la comparacion refleja lo cargado.")
    else:
        print("Verificacion incompleta: queda la comparacion de antes de cargar (la carga ya esta hecha).")
    return 1 if fallas else 0


if __name__ == "__main__":
    raise SystemExit(main())
