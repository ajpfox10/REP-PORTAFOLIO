"""
Carga en `ocupaciones` (ley 10430, ley_id 3) todos los cargos del nomenclador (mig 094/095)
y repunta agentes.ocupacion_id cuando el nombre viejo es EXACTAMENTE un cargo del Excel
(ej. 'Enfermero B' -> Enfermero "B"). El resto de las ocupaciones viejas no se toca.

- agrupamiento = nombre del agrupamiento, codigo = codigo del cargo, nombre = denominacion
  (si la misma denominacion se repite en el Excel se le agrega ' [AGRUPAMIENTO CODIGO]').
- regimen_horario_id / es_insalubre / especialidad_id se heredan de la ocupacion vieja
  cuando se repunta (solo si la nueva no los tiene).
- Hace backup de ocupaciones y de agentes.ocupacion_id antes de escribir.

Uso:  python cargar_ocupaciones_nomenclador.py [--dry-run]
Re-ejecutable: actualiza por nomenclador_cargo_id.
"""
import os
import re
import sys
import unicodedata
from collections import defaultdict

import pymysql

_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
if os.path.exists(_env):
    for _l in open(_env, encoding="utf-8", errors="ignore"):
        if _l.startswith("DB_") and "=" in _l:
            _k, _v = _l.strip().split("=", 1)
            os.environ.setdefault(_k, _v)

LEY_10430 = 3
SUFIJO = "20261026"


def clave(s):
    """Nombre sin acentos, comillas ni mayusculas: 'Enfermero "B"' == 'enfermero b'."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    s = re.sub(r"[\"“”«»'´`]", "", s)
    return " ".join(s.split())


def main():
    dry = "--dry-run" in sys.argv
    cn = pymysql.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"), port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"), password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "personalv5"), charset="utf8mb4", autocommit=False,
    )
    cur = cn.cursor()
    cur.execute("""SELECT c.id, a.nombre, c.codigo, c.denominacion, c.vigente
                   FROM nomenclador_cargos c JOIN nomenclador_agrupamientos a ON a.id = c.agrupamiento_id
                   ORDER BY c.agrupamiento_id, c.codigo""")
    cargos = cur.fetchall()
    por_nombre = defaultdict(list)
    for cid, agr, cod, den, vig in cargos:
        por_nombre[clave(den)].append(cid)

    cur.execute("SELECT id, nombre, ley_id, regimen_horario_id, es_insalubre, especialidad_id, nomenclador_cargo_id "
                "FROM ocupaciones WHERE deleted_at IS NULL")
    viejas = cur.fetchall()
    # nombres ya ocupados por otras filas (unique nombre+ley)
    ocupados = {(clave(n), l): i for i, n, l, *_ in viejas}

    nuevas, vinculadas = [], {}
    for cid, agr, cod, den, vig in cargos:
        nombre = den.strip()
        if len(por_nombre[clave(den)]) > 1:
            nombre = f"{nombre} [{agr} {cod:04d}]"
        nuevas.append((cid, agr, cod, nombre, 1 if vig else 0))

    # ocupaciones viejas cuyo nombre es exactamente un cargo del Excel (y unico entre agrupamientos)
    exactas = {}
    for i, n, l, reg, ins, esp, ncid in viejas:
        if ncid is None and l == LEY_10430:
            ids = por_nombre.get(clave(n), [])
            if len(ids) == 1:
                exactas[i] = (ids[0], reg, ins, esp)

    cur.execute("SELECT ocupacion_id, COUNT(*) FROM agentes WHERE deleted_at IS NULL AND ocupacion_id IS NOT NULL "
                "GROUP BY ocupacion_id")
    n_agentes = dict(cur.fetchall())
    print(f"cargos del Excel a cargar en ocupaciones: {len(nuevas)}")
    print(f"ocupaciones viejas con nombre exacto de un cargo: {len(exactas)} "
          f"({sum(n_agentes.get(i, 0) for i in exactas)} agentes)")
    if dry:
        print("--dry-run: no se escribio nada")
        return

    cur.execute(f"CREATE TABLE IF NOT EXISTS ocupaciones_bkp_{SUFIJO} AS SELECT * FROM ocupaciones")
    cur.execute(f"CREATE TABLE IF NOT EXISTS agentes_ocup_bkp_{SUFIJO} AS SELECT id, ocupacion_id FROM agentes")

    cur.execute("SELECT nomenclador_cargo_id, id FROM ocupaciones WHERE nomenclador_cargo_id IS NOT NULL")
    ya = dict(cur.fetchall())
    destino = {}                              # cargo_id -> ocupacion id
    creadas = actualizadas = 0
    for cid, agr, cod, nombre, vig in nuevas:
        if cid in ya:
            cur.execute("UPDATE ocupaciones SET nombre=%s, codigo=%s, agrupamiento=%s, activo=%s, ley_id=%s WHERE id=%s",
                        (nombre, cod, agr, vig, LEY_10430, ya[cid]))
            destino[cid] = ya[cid]
            actualizadas += 1
            continue
        previa = ocupados.get((clave(nombre), LEY_10430))
        if previa and previa in exactas and exactas[previa][0] == cid:
            # la propia ocupacion vieja ES el cargo: se reutiliza (conserva id y agentes)
            cur.execute("UPDATE ocupaciones SET nombre=%s, codigo=%s, agrupamiento=%s, activo=%s, nomenclador_cargo_id=%s "
                        "WHERE id=%s", (nombre, cod, agr, vig, cid, previa))
            destino[cid] = previa
            actualizadas += 1
            exactas.pop(previa)               # ya no hay que repuntar
            continue
        cur.execute("INSERT INTO ocupaciones (nombre, codigo, agrupamiento, ley_id, activo, nomenclador_cargo_id) "
                    "VALUES (%s, %s, %s, %s, %s, %s)", (nombre, cod, agr, LEY_10430, vig, cid))
        destino[cid] = cur.lastrowid
        creadas += 1

    repuntados = 0
    for vieja, (cid, reg, ins, esp) in exactas.items():
        nueva = destino[cid]
        cur.execute("UPDATE ocupaciones SET regimen_horario_id = COALESCE(regimen_horario_id, %s), "
                    "es_insalubre = COALESCE(es_insalubre, %s), especialidad_id = COALESCE(especialidad_id, %s) "
                    "WHERE id=%s", (reg, ins, esp, nueva))
        cur.execute("UPDATE agentes SET ocupacion_id=%s WHERE ocupacion_id=%s", (nueva, vieja))
        repuntados += cur.rowcount
        cur.execute("UPDATE ocupaciones SET activo=0, deleted_at=NOW() WHERE id=%s", (vieja,))
    # columnas del Excel (mig 096) copiadas de nomenclador_cargos
    cur.execute("""UPDATE ocupaciones o JOIN nomenclador_cargos c ON c.id = o.nomenclador_cargo_id
                      SET o.agrupamiento_id = c.agrupamiento_id, o.letra = c.letra,
                          o.descripcion_tareas = c.descripcion_tareas, o.requisitos = c.requisitos,
                          o.caracteristicas = c.caracteristicas, o.incorporado_por = c.incorporado_por,
                          o.dejado_sin_efecto_por = c.dejado_sin_efecto_por,
                          o.ambito_aplicacion = c.ambito_aplicacion""")
    cn.commit()
    print(f"OK: {creadas} creadas, {actualizadas} actualizadas, {repuntados} agentes repuntados, "
          f"{len(exactas)} ocupaciones viejas dadas de baja")
    cn.close()


if __name__ == "__main__":
    main()
