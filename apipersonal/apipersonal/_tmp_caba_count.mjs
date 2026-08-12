import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  dateStrings: true,
});

console.log('=== Los 20 "Falta domicilio": que hay realmente en la base ===');
const [rows] = await conn.query(`
  SELECT e.dni, p.apellido,
         p.localidad_id AS locid, loc.provincia_nombre AS prov, loc.localidad_nombre AS loca,
         p.domicilio, p.cp, LEFT(e.detalle,60) AS detalle
  FROM becarios_art_errores e
  JOIN personal p           ON p.dni = e.dni AND p.deleted_at IS NULL
  LEFT JOIN localidades loc ON loc.id = p.localidad_id
  WHERE e.motivo LIKE 'Falta domicilio%'
  ORDER BY p.apellido
`);
console.table(rows);

// Heuristica: cuantos de esos "falta domicilio" tienen pinta de CABA
const cabaRe = /CABA|CAPITAL|AUTONOMA|CIUDAD DE BUENOS AIRES/i;
const cabaLike = rows.filter(r =>
  cabaRe.test([r.prov, r.loca, r.domicilio, r.detalle].map(x => String(x||'')).join(' '))
);
console.log(`\nDe los 20 "falta domicilio", con pinta de CABA (por prov/loca/domicilio/detalle): ${cabaLike.length}`);
console.table(cabaLike.map(r => ({ dni: r.dni, apellido: r.apellido, domicilio: r.domicilio, cp: r.cp })));

await conn.end();
