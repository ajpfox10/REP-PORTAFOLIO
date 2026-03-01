// Bloquea ediciones si el registro fue creado hace más de 24hs
import { Request, Response, NextFunction } from 'express';

const SALUD_TABLES = ['reconocimientos_medicos', 'examen_anual'];
const VENTANA_MS = 24 * 60 * 60 * 1000; // 24 horas

export const saludLaboralTimeGuard = async (
  req: Request, res: Response, next: NextFunction
) => {
  const table = String(req.params.table || '');
  if (!SALUD_TABLES.includes(table)) return next();

  // Solo aplica a usuarios con rol salud_laboral (no a admin)
  const auth = (req as any).auth;
  const perms: string[] = auth?.permissions || [];
  const isAdmin = perms.includes('crud:*:*') || perms.includes('*');
  if (isAdmin) return next();

  try {
    const sequelize = (req as any).app?.locals?.sequelize;
    const model = sequelize?.models?.[table];
    if (!model) return next();

    const pk = Object.keys(model.primaryKeys || {})[0] || 'id';
    const record = await model.findOne({ where: { [pk]: req.params.id } });
    if (!record) return next(); // el 404 lo maneja el CRUD

    const createdAt = record.get('created_at') as Date;
    if (createdAt && (Date.now() - new Date(createdAt).getTime()) > VENTANA_MS) {
      return res.status(403).json({
        ok: false,
        error: 'No podés editar este registro: ya pasó más de 24 horas desde su carga.'
      });
    }
  } catch {
    // si falla la validación, dejar pasar (no romper el flujo)
  }

  return next();
};