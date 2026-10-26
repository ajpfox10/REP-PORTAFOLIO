"""
Repunta los agentes de las ocupaciones viejas a la
ocupacion equivalente del nomenclador (mig 095/096: ocupaciones.nomenclador_cargo_id).

Regla elegida por el usuario: cuando la familia tiene varias letras se usa la letra
inicial (la mas baja, "D"); si el nombre viejo ya dice el nivel (Enfermera B, Oficial
Administrativo = B, Auxiliar = C, Ayudante = D) se respeta. No usa el SIAPE.

- Se mueven TODOS los agentes con esa ocupacion (cualquier ley); las ocupaciones viejas NO se dan de baja
  (las usan agentes de otras leyes).
- regimen_horario_id / es_insalubre / especialidad_id se heredan de la ocupacion vieja
  cuando la nueva no los tiene.
- Backup: agentes_ocup_bkp_20261026d.

Uso:  python repuntar_ocupaciones_10430.py [--dry-run]
"""
import os
import sys

import pymysql

_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
if os.path.exists(_env):
    for _l in open(_env, encoding="utf-8", errors="ignore"):
        if _l.startswith("DB_") and "=" in _l:
            _k, _v = _l.strip().split("=", 1)
            os.environ.setdefault(_k, _v)

# id de ocupacion vieja -> (agrupamiento, codigo del cargo del nomenclador)
MAPA = {
    # Enfermeria -> Enfermero "D"; las que traen letra la respetan
    86: (4, 244), 145: (4, 244), 88: (4, 244), 153: (4, 244), 162: (4, 244), 158: (4, 244),
    793: (4, 241), 816: (4, 242), 867: (4, 243),
    # Administrativos
    165: (3, 4), 76: (3, 4), 159: (3, 4),   # Ayudante -> "D"
    586: (3, 3),                            # Auxiliar Administrativo -> "C"
    551: (3, 2),                            # Oficial Administrativo -> "B"
    # Servicio
    127: (1, 36), 164: (1, 36),             # Mucama / Mucamo "D"
    77: (1, 3),                             # Camillero "D"
    89: (1, 23),                            # Guardian "D"
    # Obrero
    160: (2, 119),                          # Ayudante de Mantenimiento
    129: (2, 41),                           # Operador de Conmutador Telefonico "D"
    85: (2, 59),                            # Electricista Instalador, Medio Oficial "D"
    423: (2, 33),                           # Carnicero "D"
    # Tecnico
    926: (4, 136),                          # Auxiliar de Radiologia "D"
    140: (4, 312), 151: (4, 312),                          # Instrumentador Quirurgico "D"
    739: (4, 78),                           # Auxiliar de Farmacia "B" (lo dice el nombre)
    75: (4, 80), 74: (4, 80),               # Auxiliar de Farmacia "D"
    934: (4, 172),                          # Ayudante de Hemoterapia "D"
    685: (4, 92),                           # Auxiliar de Hemoterapia "D"
    133: (4, 60),                           # Ayudante de Esterilizacion "D"
    141: (4, 532),                          # Tecnico en Radiologia y Radioterapia "D"
    169: (4, 68),                           # Auxiliar de Electroencefalocardiografia "D"
    135: (4, 196),                          # Tecnico en Citologia "D"
    # Profesional
    72: (5, 4),                             # Abogado "D"
}
# Sin cargo en el Excel (no se mueven): 302 Chofer A, 78 Capellan


def main():
    dry = "--dry-run" in sys.argv
    cn = pymysql.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"), port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"), password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "personalv5"), charset="utf8mb4", autocommit=False,
    )
    cur = cn.cursor()
    cur.execute("""SELECT o.id, c.agrupamiento_id, c.codigo FROM ocupaciones o
                   JOIN nomenclador_cargos c ON c.id = o.nomenclador_cargo_id""")
    destino = {(a, c): i for i, a, c in cur.fetchall()}
    faltan = [v for v in MAPA.values() if v not in destino]
    if faltan:
        sys.exit(f"cargos sin ocupacion nueva: {faltan}")

    total = 0
    resumen = []
    for vieja, clave in MAPA.items():
        cur.execute("SELECT nombre, regimen_horario_id, es_insalubre, especialidad_id FROM ocupaciones WHERE id=%s", (vieja,))
        nombre, reg, ins, esp = cur.fetchone()
        cur.execute("SELECT COUNT(*) FROM agentes WHERE ocupacion_id=%s AND ley_id NOT IN (4, 5)", (vieja,))
        n = cur.fetchone()[0]
        cur.execute("SELECT nombre FROM ocupaciones WHERE id=%s", (destino[clave],))
        resumen.append((vieja, nombre.strip(), cur.fetchone()[0], n))
        total += n
        if not dry and n:
            nueva = destino[clave]
            cur.execute("UPDATE ocupaciones SET regimen_horario_id = COALESCE(regimen_horario_id, %s), "
                        "es_insalubre = COALESCE(es_insalubre, %s), especialidad_id = COALESCE(especialidad_id, %s) "
                        "WHERE id=%s", (reg, ins, esp, nueva))
            if vieja == 98 or vieja == 200 or vieja == 72:
                pass
    if dry:
        for r in resumen:
            print(r)
        print(f"{total} agentes 10430 a repuntar. --dry-run: no se escribio nada")
        return

    cur.execute("CREATE TABLE IF NOT EXISTS agentes_ocup_bkp_20261026d AS SELECT id, ocupacion_id FROM agentes")
    movidos = 0
    for vieja, clave in MAPA.items():
        cur.execute("UPDATE agentes SET ocupacion_id=%s WHERE ocupacion_id=%s AND ley_id NOT IN (4, 5)",
                    (destino[clave], vieja))
        movidos += cur.rowcount
    cn.commit()
    print(f"OK: {movidos} agentes repuntados")
    cn.close()


if __name__ == "__main__":
    main()
