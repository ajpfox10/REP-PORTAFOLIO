# pedidos_carga.py — "Cargar" desde /app/asistencia (05/11/2026)
# El boton guarda en carga_intranet_pedidos las filas elegidas (ids de novedades_carga_intranet).
# Al arrancar, el robot de carga (novedades / ausentes) de esa dependencia busca pedidos sin usar de las
# ultimas HORAS_VIGENCIA horas: si hay, carga SOLO esas filas y los marca usados; si no, toda la cola (circuito).

TABLA = "carga_intranet_pedidos"
HORAS_VIGENCIA = 2


def crear_tabla(cur):
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLA} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          tipo VARCHAR(20) NOT NULL,
          dependencia VARCHAR(20) NOT NULL,
          ids MEDIUMTEXT NOT NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          usado_en DATETIME NULL,
          PRIMARY KEY (id),
          KEY idx_pedidos_pend (tipo, dependencia, usado_en)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""")


def tomar_pedido(cur, tipo, dependencia):
    """Ids pedidos (set) de los pedidos sin usar vigentes de tipo+dependencia, y los marca usados.
    None si no hay pedido (= cargar toda la cola)."""
    crear_tabla(cur)
    cur.execute(f"""
        SELECT id, ids FROM {TABLA}
         WHERE tipo = %s AND dependencia = %s AND usado_en IS NULL
           AND creado_en >= NOW() - INTERVAL %s HOUR""", (tipo, dependencia, HORAS_VIGENCIA))
    filas = cur.fetchall()
    if not filas:
        return None
    ids = set()
    for f in filas:
        for x in str(f["ids"] or "").split(","):
            x = x.strip()
            if x.isdigit():
                ids.add(int(x))
    cur.execute(f"UPDATE {TABLA} SET usado_en = NOW() WHERE id IN ({','.join(['%s'] * len(filas))})",
                [f["id"] for f in filas])
    return ids
