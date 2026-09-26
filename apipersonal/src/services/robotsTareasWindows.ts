// src/services/robotsTareasWindows.ts
// Una tarea del Programador de Windows POR ROBOT (carpeta \Robots\, nombre = script),
// creada/actualizada desde la página Robots. Ejecuta `python run_robot.py <script>`
// en la sesión interactiva del usuario del backend (los robots manejan ventanas:
// SIAPE por JAB, Chrome de la Intranet), por eso LogonType Interactive y sin contraseña.
// run_robot.py registra la corrida en script_runs y hace que los robots del mismo
// recurso (SIAPE / Intranet) esperen su turno para no pisarse.

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

export const CARPETA_TAREAS = '\\Robots\\';

const DIA_PS: Record<string, string> = {
  LU: 'Monday', MA: 'Tuesday', MI: 'Wednesday', JU: 'Thursday', VI: 'Friday', SA: 'Saturday', DO: 'Sunday',
};

export function resolverScriptsDir(): string {
  const candidatos = [
    process.env.ROBOTS_SCRIPT_DIR?.trim(),
    process.env.INTRANET_SCRIPT_DIR?.trim(),
    path.resolve(__dirname, '../../scripts'),
    path.resolve(process.cwd(), 'scripts'),
  ].filter(Boolean) as string[];
  return candidatos.find(d => fs.existsSync(path.join(d, 'run_robot.py'))) || candidatos[0];
}

function ps(script: string, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message || '').toString().trim().slice(0, 500)));
        resolve(stdout.toString());
      });
  });
}

// Solo nombres de la tabla robots_config: [a-z0-9_]. Nada del usuario llega crudo a PowerShell.
function nombreSeguro(script: string): string {
  if (!/^[a-z0-9_]{1,100}$/.test(script)) throw new Error(`Nombre de robot inválido: ${script}`);
  return script;
}

export interface Programacion {
  dias: string[];          // LU..DO; vacío + cadaN null = todos los días
  cadaN: number | null;
  hora: string;            // HH:MM
}

export async function crearOActualizarTarea(script: string, descripcion: string, p: Programacion): Promise<void> {
  const nombre = nombreSeguro(script);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.hora)) throw new Error('Hora inválida');
  const dir = resolverScriptsDir();
  if (!fs.existsSync(path.join(dir, 'run_robot.py'))) throw new Error(`No encuentro run_robot.py en ${dir}`);
  const dias = p.dias.map(d => DIA_PS[d]).filter(Boolean);

  // hora exacta HH:MM:00 (con '-At "HH:MM"' Windows le deja los segundos del momento)
  const at = `([datetime]::Today.Add([timespan]::Parse('${p.hora}:00')))`;
  const trigger = dias.length
    ? `New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${dias.join(',')} -At ${at}`
    : `New-ScheduledTaskTrigger -Daily -DaysInterval ${p.cadaN && p.cadaN > 1 ? Math.floor(p.cadaN) : 1} -At ${at}`;
  const desc = descripcion.replace(/'/g, "''").slice(0, 200);
  const dirPs = dir.replace(/'/g, "''");

  await ps(`
$ErrorActionPreference = 'Stop'
$py = (Get-Command python -ErrorAction Stop).Source
$accion = New-ScheduledTaskAction -Execute $py -Argument 'run_robot.py ${nombre}' -WorkingDirectory '${dirPs}'
$disparo = ${trigger}
$quien = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$opc = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 8) -StartWhenAvailable
Register-ScheduledTask -TaskPath '${CARPETA_TAREAS}' -TaskName '${nombre}' -Action $accion -Trigger $disparo -Principal $quien -Settings $opc -Description 'Robot: ${desc} (creada desde la página Robots)' -Force | Out-Null
`);
}

export async function borrarTarea(script: string): Promise<void> {
  const nombre = nombreSeguro(script);
  await ps(`
$t = Get-ScheduledTask -TaskPath '${CARPETA_TAREAS}' -TaskName '${nombre}' -ErrorAction SilentlyContinue
if ($t) { Unregister-ScheduledTask -TaskPath '${CARPETA_TAREAS}' -TaskName '${nombre}' -Confirm:$false }
`);
}

export async function ejecutarAhora(script: string): Promise<'tarea' | 'directo'> {
  const nombre = nombreSeguro(script);
  const out = await ps(`
$t = Get-ScheduledTask -TaskPath '${CARPETA_TAREAS}' -TaskName '${nombre}' -ErrorAction SilentlyContinue
if ($t) { Start-ScheduledTask -TaskPath '${CARPETA_TAREAS}' -TaskName '${nombre}'; 'tarea' } else { 'no' }
`);
  if (out.trim() === 'tarea') return 'tarea';
  // sin tarea programada: se lanza directo en la sesión del backend, desacoplado
  const dir = resolverScriptsDir();
  await ps(`Start-Process -FilePath (Get-Command python).Source -ArgumentList 'run_robot.py ${nombre}' -WorkingDirectory '${dir.replace(/'/g, "''")}' -WindowStyle Minimized`);
  return 'directo';
}

export interface EstadoTarea { existe: boolean; estado?: string; proxima?: string | null; ultima?: string | null; ultimoResultado?: number | null }

/** Estado real de las tareas \Robots\ + de las tareas viejas nombradas en tarea_windows. */
export async function estadoTareas(viejas: string[]): Promise<{ robots: Record<string, EstadoTarea>; viejas: Record<string, EstadoTarea> }> {
  const nombresViejas = viejas.filter(n => /^[A-Za-z0-9_\- ]{1,120}$/.test(n)).map(n => `'${n}'`).join(',');
  const out = await ps(`
$res = @()
foreach ($t in @(Get-ScheduledTask -TaskPath '${CARPETA_TAREAS}' -ErrorAction SilentlyContinue)) {
  $i = $t | Get-ScheduledTaskInfo
  $res += [pscustomobject]@{ tipo='robot'; nombre=$t.TaskName; estado="$($t.State)"; proxima=$i.NextRunTime; ultima=$i.LastRunTime; resultado=$i.LastTaskResult }
}
foreach ($n in @(${nombresViejas})) {
  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($t) { $i = $t | Get-ScheduledTaskInfo; $res += [pscustomobject]@{ tipo='vieja'; nombre=$t.TaskName; estado="$($t.State)"; proxima=$i.NextRunTime; ultima=$i.LastRunTime; resultado=$i.LastTaskResult } }
}
ConvertTo-Json -InputObject @($res) -Compress -Depth 3
`, 30000);
  const robots: Record<string, EstadoTarea> = {};
  const viejasOut: Record<string, EstadoTarea> = {};
  const fecha = (v: any) => {
    const m = /Date\((\d+)\)/.exec(String(v ?? ''));
    if (!m) return null;
    const d = new Date(Number(m[1]));
    return d.getFullYear() < 2000 ? null : d.toISOString();
  };
  let lista: any[] = [];
  try { lista = JSON.parse(out.trim() || '[]'); } catch { lista = []; }
  for (const r of lista) {
    const e: EstadoTarea = { existe: true, estado: r.estado, proxima: fecha(r.proxima), ultima: fecha(r.ultima), ultimoResultado: r.resultado ?? null };
    if (r.tipo === 'robot') robots[r.nombre] = e; else viejasOut[r.nombre] = e;
  }
  return { robots, viejas: viejasOut };
}
