import fs from 'fs';
import mysql from 'mysql2/promise';
const envTxt = fs.readFileSync('C:/apps/personalprod/apipersonal-prod/.env','utf8');
const env = {}; for (const l of envTxt.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
const adms = await mysql.createConnection({host:env.FICHERO_MYSQL_HOST,port:+env.FICHERO_MYSQL_PORT,user:env.FICHERO_MYSQL_USER,password:env.FICHERO_MYSQL_PASS,database:env.FICHERO_MYSQL_DB});
const p=(l,r)=>{console.log('\n=== '+l+' ===');console.table(r);};
// records surrounding the backfill block to date its insertion
const [s]=await adms.query(`SELECT id, SN, checktime FROM checkinout WHERE id BETWEEN 1057226 AND 1057235 OR id BETWEEN 1057316 AND 1057326 ORDER BY id`);
p('id alrededor del bloque backfill (checktime = lo que se fichaba EN VIVO al momento de insertar)', s.map(r=>({id:r.id, SN:r.SN, checktime:String(r.checktime)})));
await adms.end();
