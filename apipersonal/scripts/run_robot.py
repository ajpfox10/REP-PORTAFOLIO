"""
Lanzador comun de robots: corre el `comando` de un robot de la tabla
`robots_config` y registra la corrida en `script_runs` (pagina Robots SIAPE).

- Robots con reporta_solo = 1 (exportaciones SIAPE, Intranet) ya escriben su
  propia fila: aca solo se registra si NO llegaron a arrancar / se cayeron sin
  escribirla, para que nunca quede una corrida sin registro.
- El resto: estado = ok si el exit code es 0, error si no; motivo = ultimas
  lineas utiles de la salida; la salida completa queda en logs/<script>.log.

Turnos: los robots que usan el mismo recurso NO corren a la vez (misma ventana
de SIAPE / mismo perfil de Chrome de la Intranet). Cada uno toma un lock de
MySQL (GET_LOCK) de su recurso y, si esta ocupado, espera su turno hasta
ESPERA_MAX_SEG; si no llega, registra error "no le toco el turno".

Solo ejecuta comandos de la tabla (no recibe comandos arbitrarios).

Uso:
  python run_robot.py siape_carga_stress
  python run_robot.py siape_novedades_por_periodo
"""
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN  # conn() + registrar_run() + .env

SCRIPTS_DIR = Path(__file__).resolve().parent
LOGS_DIR = SCRIPTS_DIR / "logs"
ESPERA_MAX_SEG = 3 * 60 * 60


def recurso_de(cfg):
    """Robots que no pueden correr juntos comparten recurso."""
    return "robots_intranet" if cfg.get("grupo") == "Intranet MS" else "robots_siape"


def _ultima_fila(cur, script):
    cur.execute("SELECT MAX(id) AS id FROM script_runs WHERE script = %s", (script,))
    r = cur.fetchone()
    return (r or {}).get("id") or 0


def _resumen_salida(lineas, n=3):
    utiles = [l.strip() for l in lineas if l.strip() and not l.strip().startswith("====")]
    return " | ".join(utiles[-n:])[:480]


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    script = sys.argv[1]

    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("SELECT * FROM robots_config WHERE script = %s AND activo = 1", (script,))
        cfg = cur.fetchone()
        previa = _ultima_fila(cur, script) if cfg else 0
    if not cfg:
        print(f"ERROR: '{script}' no esta en robots_config (o esta inactivo).")
        return 2
    if not cfg.get("comando"):
        MN.registrar_run(script, cfg["descripcion"], "error",
                         motivo="Este robot no tiene comando para correr solo (lo lanza otra pantalla).")
        return 2

    LOGS_DIR.mkdir(exist_ok=True)
    log_path = LOGS_DIR / f"{script}.log"

    # turno: la conexion que toma el lock queda abierta hasta el final
    recurso = recurso_de(cfg)
    cn_lock = MN.conn()
    t_espera = time.time()
    with cn_lock.cursor() as cur:
        cur.execute("SELECT GET_LOCK(%s, %s) AS ok", (recurso, ESPERA_MAX_SEG))
        tengo = (cur.fetchone() or {}).get("ok") == 1
    if not tengo:
        cn_lock.close()
        MN.registrar_run(script, cfg["descripcion"], "error",
                         motivo=f"No le toco el turno: otro robot de {recurso} siguio ocupado {ESPERA_MAX_SEG // 60} min.",
                         duracion_seg=int(time.time() - t_espera))
        return 3
    esperado = int(time.time() - t_espera)
    if esperado > 5:
        print(f"Espero su turno {esperado}s ({recurso}).")

    t0 = time.time()
    lineas = []
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    with open(log_path, "a", encoding="utf-8", errors="replace") as log:
        log.write(f"\n==== {datetime.now():%Y-%m-%d %H:%M:%S} {cfg['comando']} ====\n")
        try:
            p = subprocess.Popen(cfg["comando"], cwd=SCRIPTS_DIR, shell=True, env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, encoding="utf-8", errors="replace")
            for linea in p.stdout:
                log.write(linea)
                log.flush()
                lineas.append(linea)
                lineas = lineas[-200:]
            code = p.wait()
        except Exception as e:
            code = -1
            lineas.append(f"No se pudo lanzar: {e}")
            log.write(lineas[-1] + "\n")
    dur = int(time.time() - t0)
    try:
        with cn_lock.cursor() as cur:
            cur.execute("SELECT RELEASE_LOCK(%s)", (recurso,))
        cn_lock.close()
    except Exception:
        pass  # si la conexion murio, MySQL libera el lock solo

    if cfg.get("reporta_solo"):
        with MN.conn() as cn, cn.cursor() as cur:
            escribio = _ultima_fila(cur, script) > previa
        if escribio:
            return code
        MN.registrar_run(script, cfg["descripcion"], "error",
                         motivo=f"Termino (codigo {code}) sin registrar su resultado: {_resumen_salida(lineas)}",
                         archivo=str(log_path), duracion_seg=dur)
        return code or 1

    MN.registrar_run(script, cfg["descripcion"], "ok" if code == 0 else "error",
                     motivo=(_resumen_salida(lineas) if code == 0
                             else f"Codigo {code}: {_resumen_salida(lineas)}"),
                     archivo=str(log_path), duracion_seg=dur)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
