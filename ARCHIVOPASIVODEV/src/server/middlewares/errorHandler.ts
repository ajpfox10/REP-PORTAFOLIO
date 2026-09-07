import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodIssue } from "zod";

const fieldLabels: Record<string, string> = {
  dni: "DNI",
  apellido_nombre: "Apellido y nombre",
  fecha_ultimo_movimiento: "Fecha ultimo movimiento",
  comentarios: "Comentarios",
  menor: "Criterio menor",
  mayor: "Criterio mayor",
  historiaClinicaId: "Historia clinica",
  resuelto: "Estado",
};

function labelFor(issue: ZodIssue) {
  const key = String(issue.path[0] ?? "dato");
  return fieldLabels[key] || key;
}

function messageFor(issue: ZodIssue) {
  const field = labelFor(issue);
  if (issue.code === "invalid_type") return `${field}: dato requerido o con formato invalido.`;
  if (issue.code === "too_small" && issue.type === "string") return `${field}: debe tener al menos ${issue.minimum} caracteres.`;
  if (issue.code === "too_small" && issue.type === "number") return `${field}: debe ser como minimo ${issue.minimum}.`;
  if (issue.code === "too_big" && issue.type === "string") return `${field}: supera el maximo de ${issue.maximum} caracteres.`;
  if (issue.code === "too_big" && issue.type === "number") return `${field}: no puede ser mayor que ${issue.maximum}.`;
  if (issue.code === "invalid_string" && issue.validation === "regex") return `${field}: debe tener formato AAAA-MM-DD.`;
  return `${field}: ${issue.message}`;
}

function validationMessage(error: ZodError) {
  return error.issues.map(messageFor).join(" ");
}

// Responde errores de forma uniforme y con validaciones utiles para el operador.
export function errorHandler(err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      ok: false,
      error: validationMessage(err),
      requestId: req.requestId,
    });
    return;
  }

  const status = err.status && err.status >= 400 ? err.status : 500;
  res.status(status).json({
    ok: false,
    error: status >= 500 ? "Error interno" : err.message,
    requestId: req.requestId,
  });
}
