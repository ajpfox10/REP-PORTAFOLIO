// tarjeta.ts — arma la imagen de la felicitación en un canvas (1080×1080, JPG).
// Fondo: uno de los diseños predefinidos (dibujados acá, no son archivos) o una imagen subida
// en la página. Encima, si está activado, "¡Feliz cumpleaños!" + el nombre del agente.
import { apiFetch } from '../../api/http';

export const LADO = 1080;

export const DISENOS: { id: string; nombre: string }[] = [
  { id: 'diseno:globos', nombre: 'Globos' },
  { id: 'diseno:confeti', nombre: 'Confeti dorado' },
  { id: 'diseno:torta', nombre: 'Torta' },
  { id: 'diseno:flores', nombre: 'Flores' },
];

/** Generador pseudoaleatorio con semilla: el mismo diseño sale siempre igual. */
function azar(semilla: number) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Imágenes que no son diseños: 'subida:<id>' (guardada en la base) o 'carpeta:<archivo>'
// (D:\G\TARJETAS CUMPLEANOS). Se traen una sola vez por sesión y quedan listas para dibujar.
const imagenesCache = new Map<string, Promise<HTMLImageElement>>();
function urlImagen(clave: string) {
  if (clave.startsWith('subida:')) return `/alertas-cumpleanos/felicitacion/imagenes/${Number(clave.slice(7))}`;
  return `/alertas-cumpleanos/felicitacion/carpeta/${encodeURIComponent(clave.slice(8))}`;
}
export function imagenExterna(clave: string): Promise<HTMLImageElement> {
  if (!imagenesCache.has(clave)) {
    const p = apiFetch<any>(urlImagen(clave)).then((r) => new Promise<HTMLImageElement>((ok, mal) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => mal(new Error('No se pudo abrir la imagen'));
      img.src = `data:${r.data.mime};base64,${r.data.base64}`;
    }));
    p.catch(() => imagenesCache.delete(clave));
    imagenesCache.set(clave, p);
  }
  return imagenesCache.get(clave)!;
}
export function olvidarImagenSubida(id: number) { imagenesCache.delete(`subida:${id}`); }
/** Al tocar "Actualizar carpeta": olvida las de la carpeta (pudieron reemplazarse con el mismo nombre). */
export function olvidarImagenesCarpeta() {
  for (const k of [...imagenesCache.keys()]) if (k.startsWith('carpeta:')) imagenesCache.delete(k);
}

function degradado(ctx: CanvasRenderingContext2D, c1: string, c2: string) {
  const g = ctx.createLinearGradient(0, 0, LADO, LADO);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, LADO, LADO);
}

function globo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 1.2);
  ctx.bezierCurveTo(x - 25, y + r * 1.8, x + 25, y + r * 2.3, x, y + r * 3);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y - r * 0.45, r * 0.18, r * 0.3, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function fondoDiseno(ctx: CanvasRenderingContext2D, id: string) {
  const r = azar(id.length * 7919 + id.charCodeAt(7));
  if (id === 'diseno:confeti') {
    degradado(ctx, '#0f172a', '#312e81');
    const colores = ['#fbbf24', '#f59e0b', '#fde68a', '#f472b6', '#38bdf8', '#a78bfa'];
    for (let i = 0; i < 260; i++) {
      ctx.save();
      ctx.translate(r() * LADO, r() * LADO);
      ctx.rotate(r() * Math.PI);
      ctx.fillStyle = colores[Math.floor(r() * colores.length)];
      ctx.globalAlpha = 0.55 + r() * 0.45;
      ctx.fillRect(-8, -3, 10 + r() * 14, 5 + r() * 5);
      ctx.restore();
    }
    return { titulo: '#fde68a', nombre: '#ffffff', sombra: 'rgba(0,0,0,0.6)' };
  }
  if (id === 'diseno:torta') {
    degradado(ctx, '#fff7ed', '#fed7aa');
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(251,146,60,${0.08 + r() * 0.12})`;
      ctx.beginPath();
      ctx.arc(r() * LADO, r() * LADO, 10 + r() * 40, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `300px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000'; // opaco: el emoji toma la transparencia del fillStyle anterior
    ctx.fillText('🎂', LADO / 2, LADO * 0.3);
    return { titulo: '#c2410c', nombre: '#7c2d12', sombra: 'rgba(255,255,255,0.6)' };
  }
  if (id === 'diseno:flores') {
    degradado(ctx, '#ecfdf5', '#a7f3d0');
    const colores = ['#f9a8d4', '#fda4af', '#fcd34d', '#c4b5fd', '#fbcfe8'];
    for (let i = 0; i < 26; i++) {
      const x = r() * LADO, y = r() < 0.5 ? r() * LADO * 0.25 : LADO * 0.78 + r() * LADO * 0.22, t = 22 + r() * 30;
      ctx.fillStyle = colores[Math.floor(r() * colores.length)];
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * t, y + Math.sin(a) * t, t * 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.arc(x, y, t * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    return { titulo: '#047857', nombre: '#064e3b', sombra: 'rgba(255,255,255,0.7)' };
  }
  // globos (por defecto)
  degradado(ctx, '#ec4899', '#7c3aed');
  const colores = ['#f43f5e', '#facc15', '#22d3ee', '#a3e635', '#fb923c', '#f0abfc'];
  const pos = [[130, 190, 75], [300, 130, 60], [800, 150, 70], [960, 260, 62], [110, 760, 55], [970, 790, 58], [220, 930, 45], [880, 960, 42]];
  pos.forEach(([x, y, rad], i) => globo(ctx, x, y, rad, colores[i % colores.length]));
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.35})`;
    ctx.beginPath();
    ctx.arc(r() * LADO, r() * LADO, 2 + r() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  return { titulo: '#fff7ed', nombre: '#ffffff', sombra: 'rgba(0,0,0,0.45)' };
}

/** Achica la letra hasta que el texto entre en el ancho dado. */
function ajustar(ctx: CanvasRenderingContext2D, texto: string, maxAncho: number, tam: number, fuente: string) {
  let t = tam;
  do { ctx.font = `${fuente.replace('{t}', String(t))}`; t -= 4; } while (ctx.measureText(texto).width > maxAncho && t > 30);
}

function textos(ctx: CanvasRenderingContext2D, nombre: string, col: { titulo: string; nombre: string; sombra: string }, yTitulo: number) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = col.sombra;
  ctx.shadowBlur = 14;
  ctx.fillStyle = col.titulo;
  ajustar(ctx, '¡Feliz cumpleaños!', LADO * 0.86, 104, 'italic bold {t}px Georgia, "Times New Roman", serif');
  ctx.fillText('¡Feliz cumpleaños!', LADO / 2, yTitulo);
  if (nombre) {
    ctx.fillStyle = col.nombre;
    ajustar(ctx, nombre, LADO * 0.86, 88, 'bold {t}px "Segoe UI", Arial, sans-serif');
    ctx.fillText(nombre, LADO / 2, yTitulo + 125);
  }
  ctx.shadowBlur = 0;
}

/**
 * Devuelve la tarjeta como data URL JPG. imagen = 'diseno:xxx', 'subida:<id>' o 'carpeta:<archivo>'.
 * Si la imagen elegida ya no existe (la borraron de la carpeta), se usa el diseño Globos
 * para que la felicitación salga igual; con soloEsa=true tira el error (miniaturas).
 */
export async function dibujarTarjeta(opts: { imagen: string; nombre: string; mostrarNombre: boolean; soloEsa?: boolean }): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = LADO;
  canvas.height = LADO;
  const ctx = canvas.getContext('2d')!;
  const nombre = opts.mostrarNombre ? opts.nombre : '';
  let img: HTMLImageElement | null = null;
  if (/^(subida|carpeta):/.test(opts.imagen)) {
    try { img = await imagenExterna(opts.imagen); } catch (e) {
      if (opts.soloEsa) throw e;
      return dibujarTarjeta({ ...opts, imagen: 'diseno:globos' });
    }
  }
  if (img) {
    // "cover": llena el cuadrado recortando lo que sobre, centrado
    const esc = Math.max(LADO / img.width, LADO / img.height);
    const w = img.width * esc, h = img.height * esc;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LADO, LADO);
    ctx.drawImage(img, (LADO - w) / 2, (LADO - h) / 2, w, h);
    if (opts.mostrarNombre) {
      const g = ctx.createLinearGradient(0, LADO * 0.6, 0, LADO);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = g;
      ctx.fillRect(0, LADO * 0.6, LADO, LADO * 0.4);
      textos(ctx, nombre, { titulo: '#fde68a', nombre: '#ffffff', sombra: 'rgba(0,0,0,0.7)' }, LADO * 0.8);
    }
  } else {
    const col = fondoDiseno(ctx, opts.imagen);
    // En los diseños el título va siempre; el nombre solo si está activado
    textos(ctx, nombre, col, opts.imagen === 'diseno:torta' ? LADO * 0.62 : LADO * 0.47);
  }
  return canvas.toDataURL('image/jpeg', 0.88);
}
