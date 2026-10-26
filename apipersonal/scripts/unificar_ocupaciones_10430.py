"""
Simulacion (no escribe) de la unificacion de `ocupaciones` de la Ley 10430 contra el
nomenclador (mig 094). Cada ocupacion nueva = un cargo del nomenclador con su letra
(ej. Enfermero "B"); los agentes 10430 activos se repuntan segun agrupamiento y
categoria del SIAPE.

Regla: la ocupacion conserva la FUNCION real. Si la categoria da clase 4 (cargo Inicial
"E"), la ocupacion es la letra mas baja de la familia (la D) y el Inicial queda solo en
el cargo del nomenclador del agente. Si la familia no tiene la letra de la clase
(ej. Mucama solo "D"), la ocupacion es la unica/ultima letra de la familia.

Uso:  python unificar_ocupaciones_10430.py
"""
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import equivalencias_nomenclador_10430 as eq  # noqa: E402


def main():
    cn = eq.conectar()
    with cn.cursor() as cur:
        cur.execute(eq.SQL_AGENTES)
        agentes = cur.fetchall()
        cur.execute("SELECT agrupamiento_id, codigo, denominacion, letra, vigente FROM nomenclador_cargos")
        todos = cur.fetchall()
        cur.execute("SELECT agrupamiento_id, categoria, grado, clase FROM nomenclador_categorias")
        categorias = {(a, c): (g, k) for a, c, g, k in cur.fetchall()}
        cur.execute("SELECT id, regimen_horario_id, es_insalubre FROM ocupaciones")
        oc_attr = {i: (r, e) for i, r, e in cur.fetchall()}
    cn.close()
    cargos = {(a, c): (d, l) for a, c, d, l, _ in todos}
    filas = eq.proponer(agentes, cargos, categorias)

    nuevas = defaultdict(list)       # (agr, cod) -> agentes
    sin = []
    for f in filas:
        if not f["familia"] or f["tipo"] == "REVISAR":
            sin.append(f)
            continue
        agr, codigos = eq.F[f["familia"]]
        letra_clase = eq.LETRA_DE_CLASE.get(f["clase"])
        elegido = next((c for c in codigos if cargos[(agr, c)][1] == letra_clase), None)
        if elegido is None:              # clase 4 o letra inexistente en la familia
            elegido = codigos[-1]
        nuevas[(agr, elegido)].append(f)

    print(f"{len(filas)} agentes 10430 activos -> {sum(len(v) for v in nuevas.values())} repuntables "
          f"a {len(nuevas)} ocupaciones nuevas; {len(sin)} quedan para revisar\n")
    print("OCUPACION NUEVA (cargo del nomenclador) | agentes | ocupaciones viejas que confluyen (id:n, regimen)")
    for (agr, cod), fs in sorted(nuevas.items(), key=lambda kv: -len(kv[1])):
        viejas = Counter(f["ocup_id"] for f in fs)
        regs = {oc_attr.get(i, (None, None))[0] for i in viejas}
        marca = "  <-- regimen distinto entre las viejas" if len(regs - {None}) > 1 else ""
        print(f'{agr}-{cod:04d} {cargos[(agr, cod)][0]} | {len(fs)} | '
              + ", ".join(f"{i}:{n}" for i, n in viejas.most_common(4)) + f" reg={sorted(r for r in regs if r)}{marca}")
    print("\nPARA REVISAR (no se tocan):")
    for f in sin:
        print(f'  {f["dni"]} {f["nombre"]} | {f["ocup"]} | {f["agrup"]} cat {f["cat"]} | {f["motivo"]}')


if __name__ == "__main__":
    main()
