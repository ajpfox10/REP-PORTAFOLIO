import { Router } from "express";
import { z } from "zod";
import { verifyPassword, hashPassword } from "../auth/password.js";
import { findUserById } from "../auth/users.js";
import { query } from "../db/pool.js";
import { authContext } from "../middlewares/authContext.js";
import { requirePermission } from "../middlewares/rbac.js";

const router = Router();

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

router.use(authContext);

// Permite al usuario cambiar su propia contrasena luego de ingresar.
router.post("/password", requirePermission("cuenta:editar"), async (req, res, next) => {
  try {
    const input = passwordSchema.parse(req.body);
    const user = await findUserById(req.auth!.userId);
    if (!user) return res.status(401).json({ ok: false, error: "No autenticado" });
    const ok = await verifyPassword(input.currentPassword, user.password_hash);
    if (!ok) return res.status(400).json({ ok: false, error: "Contrasena actual incorrecta" });
    await query(
      `UPDATE usuarios
          SET password_hash = :passwordHash,
              token_version = token_version + 1
        WHERE id = :id`,
      { id: user.id, passwordHash: await hashPassword(input.newPassword) }
    );
    await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE usuario_id = :id AND revoked_at IS NULL`, { id: user.id });
    res.json({ ok: true, message: "Contrasena actualizada. Vuelva a ingresar." });
  } catch (error) {
    next(error);
  }
});

export { router as accountRouter };
