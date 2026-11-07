"""
Robot "Ausentes" (04/11/2026, pedido del usuario): los AUSENTE SIN AVISO se cargan en la
Intranet MS (28 - INASISTENCIA) DESACOPLADOS del Circuito 2.0 y AL FINAL DE TODO, despues de
que el jefe y el resto de los robots ya cargaron lo suyo (si un dia termina justificado por
otra novedad, no se manda una inasistencia de mas).

  0. ESPERA: si el Circuito 2.0 o el Circuito jefe estan corriendo, espera a que terminen
     (se mira el turno de cada uno en MySQL; tope ESPERA_MAX_SEG).
  1. intranet_carga_ausentes_v2_hospital / _upa4 / _upa18   (en ese orden)

Si un robot de ausentes esta INACTIVO en robots_config (p.ej. suspendido: "no cargar al
Ministerio") no se corre: queda avisado en la salida y el robot termina OK, sin cargar nada.
Si falla una dependencia se sigue con las demas. Cada paso va por run_robot.py (pagina Robots
+ turnos de la Intranet).

Uso: python circuito_ausentes.py            (se programa desde la pagina Robots: "Ausentes")
     python circuito_ausentes.py --sin-esperar
"""
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))
import mapeo_novedades as MN

AUSENTES = [
    "intranet_carga_ausentes_v2_hospital",
    "intranet_carga_ausentes_v2_upa4",
    "intranet_carga_ausentes_v2_upa18",
]
# turnos (GET_LOCK de run_robot.py) de los circuitos que tienen que terminar antes
ANTES = {"robots_circuito": "Circuito 2.0", "robots_circuito_jefe": "Circuito jefe"}
ESPERA_MAX_SEG = 4 * 3600


def esperar_circuitos():
    """Espera a que se liberen los turnos de los otros circuitos (toma y suelta cada lock)."""
    cn = MN.conn()
    try:
        with cn.cursor() as cur:
            for recurso, nombre in ANTES.items():
                cur.execute("SELECT IS_USED_LOCK(%s) AS uso", (recurso,))
                if not (cur.fetchone() or {}).get("uso"):
                    continue
                print(f"Espero a que termine el {nombre}...", flush=True)
                t0 = time.time()
                cur.execute("SELECT GET_LOCK(%s, %s) AS ok", (recurso, ESPERA_MAX_SEG))
                if (cur.fetchone() or {}).get("ok") == 1:
                    cur.execute("SELECT RELEASE_LOCK(%s)", (recurso,))
                    print(f"  {nombre} termino ({int(time.time() - t0)}s).", flush=True)
                else:
                    print(f"  AVISO: el {nombre} sigue corriendo despues de {ESPERA_MAX_SEG // 3600} h; sigo igual.")
    finally:
        cn.close()


def activos(scripts):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(f"SELECT script, activo FROM robots_config WHERE script IN ({','.join(['%s'] * len(scripts))})",
                    tuple(scripts))
        return {r["script"]: bool(r["activo"]) for r in cur.fetchall()}


def correr(script):
    print(f"==> {script}", flush=True)
    code = subprocess.call([sys.executable, "run_robot.py", script], cwd=SCRIPTS_DIR)
    print(f"<== {script}: {'OK' if code == 0 else f'codigo {code}'}", flush=True)
    return code


def main():
    if "--sin-esperar" not in sys.argv:
        esperar_circuitos()
    estado = activos(AUSENTES)
    a_correr = [s for s in AUSENTES if estado.get(s)]
    for s in AUSENTES:
        if s not in a_correr:
            print(f"Salteado {s}: inactivo en robots_config (suspendido), no se carga nada.")
    if not a_correr:
        print("Ausentes: los 3 robots de ausentes estan suspendidos. Nada para cargar.")
        return 0
    fallas = [s for s in a_correr if correr(s) != 0]
    print(f"Ausentes: {len(a_correr) - len(fallas)}/{len(a_correr)} OK"
          + (f" - con error: {', '.join(fallas)}" if fallas else ""))
    return 1 if fallas else 0


if __name__ == "__main__":
    raise SystemExit(main())
