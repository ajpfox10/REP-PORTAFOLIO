"""
Carga el catálogo CIE-10 completo (versión OMS en español, MINSAL/DEIS 2018)
en personalv5.cie_codigos. La tabla la usa la pestaña "Por CIE" del editor de
Asistencia para mostrar el nombre de cada código.

Fuente: paquete ciecl de rOpenSci (MIT; datos MINSAL de dominio público)
  https://raw.githubusercontent.com/ropensci/ciecl/main/data/cie10_cl.rda
Requiere: pip install pyreadr

Uso:  python cargar_cie10.py <ruta a cie10_cl.rda>
Re-ejecutable: crea la tabla si no existe y actualiza por código.
"""
import os
import sys

import pymysql
import pyreadr

# DB_* del .env del API (sin pisar lo que ya venga en el entorno)
_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
if os.path.exists(_env):
    for _l in open(_env, encoding="utf-8", errors="ignore"):
        if _l.startswith("DB_") and "=" in _l:
            _k, _v = _l.strip().split("=", 1)
            os.environ.setdefault(_k, _v)

DDL = """
CREATE TABLE IF NOT EXISTS cie_codigos (
  codigo          VARCHAR(10)  NOT NULL,
  descripcion     VARCHAR(300) NOT NULL,
  categoria       VARCHAR(255) NULL,
  capitulo        VARCHAR(10)  NULL,
  capitulo_nombre VARCHAR(255) NULL,
  uso             VARCHAR(40)  NULL,
  origen          VARCHAR(60)  NOT NULL DEFAULT 'MINSAL/DEIS 2018 (ciecl)',
  cargado_en      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def txt(v, n):
    if v is None or (isinstance(v, float) and v != v):
        return None
    s = str(v).strip()
    return s[:n] if s else None


def main():
    if len(sys.argv) < 2:
        sys.exit("Uso: python cargar_cie10.py <ruta a cie10_cl.rda>")
    df = pyreadr.read_r(sys.argv[1])["cie10_cl"]
    filas = [
        (
            txt(r.codigo, 10).upper(),
            txt(r.descripcion, 300),
            txt(r.categoria, 255),
            txt(r.capitulo, 10),
            txt(r.capitulo_nombre, 255),
            txt(r.uso_cl, 40),
        )
        for r in df.itertuples()
        if txt(r.codigo, 10) and txt(r.descripcion, 300)
    ]
    cn = pymysql.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", 3306)),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "personalv5"),
        charset="utf8mb4",
    )
    with cn, cn.cursor() as cur:
        cur.execute(DDL)
        cur.executemany(
            """INSERT INTO cie_codigos (codigo, descripcion, categoria, capitulo, capitulo_nombre, uso)
               VALUES (%s,%s,%s,%s,%s,%s)
               ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion), categoria = VALUES(categoria),
                 capitulo = VALUES(capitulo), capitulo_nombre = VALUES(capitulo_nombre), uso = VALUES(uso)""",
            filas,
        )
        cn.commit()
        cur.execute("SELECT COUNT(*) FROM cie_codigos")
        print(f"cie_codigos: {cur.fetchone()[0]} códigos ({len(filas)} leídos del archivo)")


if __name__ == "__main__":
    main()
