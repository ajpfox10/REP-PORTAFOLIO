/**
 * i18n.ts — v11  (Punto 12)
 *
 * Internacionalización para:
 *   - Mensajes de error de la API
 *   - Textos de emails y notificaciones
 *   - Formatos de fecha, moneda y número por locale
 *   - Detección de locale desde: Accept-Language header, user.locale (DB), query param
 *
 * Locales soportados: es-AR (default), en-US, pt-BR
 */

import type { Request } from "express";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type SupportedLocale = "es-AR" | "en-US" | "pt-BR";

export type TranslationKey =
  | "error.validation"
  | "error.not_found"
  | "error.forbidden"
  | "error.auth_required"
  | "error.rate_limited"
  | "error.plan_required"
  | "error.conflict"
  | "error.internal"
  | "error.tenant_not_found"
  | "notif.vacuna.titulo"
  | "notif.vacuna.cuerpo"
  | "notif.turno.titulo"
  | "notif.turno.cuerpo"
  | "notif.desparasitacion.titulo"
  | "notif.desparasitacion.cuerpo"
  | "email.reset_password.subject"
  | "email.reset_password.body"
  | "email.welcome.subject"
  | "email.welcome.body"
  | "email.factura.subject"
  | "pdf.ficha.titulo"
  | "pdf.receta.titulo"
  | "pdf.vacuna.titulo"
  | "pdf.valida_hasta"
  | "common.generado_el"
  | "common.propietario"
  | "common.veterinario"
  | "common.sucursal"
  | "common.pagina";

// ── Catálogo de traducciones ──────────────────────────────────────────────────

const TRANSLATIONS: Record<SupportedLocale, Record<TranslationKey, string>> = {
  "es-AR": {
    "error.validation":       "Error de validación",
    "error.not_found":        "No encontrado",
    "error.forbidden":        "Sin permisos para realizar esta acción",
    "error.auth_required":    "Autenticación requerida",
    "error.rate_limited":     "Demasiados intentos. Intente nuevamente más tarde",
    "error.plan_required":    "Esta función requiere un plan superior",
    "error.conflict":         "Conflicto con datos existentes",
    "error.internal":         "Error interno del servidor",
    "error.tenant_not_found": "Clínica no encontrada",

    "notif.vacuna.titulo":    "Recordatorio de vacuna — {{paciente}}",
    "notif.vacuna.cuerpo":    "La vacuna {{vacuna}} de {{paciente}} vence el {{fecha}}. No olvides renovarla.",
    "notif.turno.titulo":     "Recordatorio de turno",
    "notif.turno.cuerpo":     "Mañana tenés turno para {{paciente}} con {{veterinario}} a las {{hora}}.",
    "notif.desparasitacion.titulo": "Recordatorio de desparasitación",
    "notif.desparasitacion.cuerpo": "Es momento de la desparasitación de {{paciente}} con {{producto}}.",

    "email.reset_password.subject": "Restablecer contraseña — VetPro",
    "email.reset_password.body":    "Hacé clic en el siguiente enlace para restablecer tu contraseña. El enlace expira en 1 hora.",
    "email.welcome.subject":        "Bienvenido a VetPro, {{nombre}}",
    "email.welcome.body":           "Tu cuenta fue creada exitosamente. Podés ingresar con tu email y contraseña.",
    "email.factura.subject":        "Nueva factura disponible — {{numero}}",

    "pdf.ficha.titulo":   "Ficha Clínica del Paciente",
    "pdf.receta.titulo":  "Receta Médica Veterinaria",
    "pdf.vacuna.titulo":  "Certificado de Vacunación",
    "pdf.valida_hasta":   "Válida hasta",
    "common.generado_el": "Generado el",
    "common.propietario": "Propietario/a",
    "common.veterinario": "Veterinario/a",
    "common.sucursal":    "Sucursal",
    "common.pagina":      "Página",
  },

  "en-US": {
    "error.validation":       "Validation error",
    "error.not_found":        "Not found",
    "error.forbidden":        "You don't have permission to perform this action",
    "error.auth_required":    "Authentication required",
    "error.rate_limited":     "Too many attempts. Please try again later",
    "error.plan_required":    "This feature requires a higher plan",
    "error.conflict":         "Conflict with existing data",
    "error.internal":         "Internal server error",
    "error.tenant_not_found": "Clinic not found",

    "notif.vacuna.titulo":    "Vaccine reminder — {{paciente}}",
    "notif.vacuna.cuerpo":    "The {{vacuna}} vaccine for {{paciente}} expires on {{fecha}}. Don't forget to renew it.",
    "notif.turno.titulo":     "Appointment reminder",
    "notif.turno.cuerpo":     "Tomorrow you have an appointment for {{paciente}} with {{veterinario}} at {{hora}}.",
    "notif.desparasitacion.titulo": "Deworming reminder",
    "notif.desparasitacion.cuerpo": "It's time for {{paciente}}'s deworming with {{producto}}.",

    "email.reset_password.subject": "Reset your password — VetPro",
    "email.reset_password.body":    "Click the link below to reset your password. The link expires in 1 hour.",
    "email.welcome.subject":        "Welcome to VetPro, {{nombre}}",
    "email.welcome.body":           "Your account was created successfully. You can sign in with your email and password.",
    "email.factura.subject":        "New invoice available — {{numero}}",

    "pdf.ficha.titulo":   "Patient Clinical Record",
    "pdf.receta.titulo":  "Veterinary Medical Prescription",
    "pdf.vacuna.titulo":  "Vaccination Certificate",
    "pdf.valida_hasta":   "Valid until",
    "common.generado_el": "Generated on",
    "common.propietario": "Owner",
    "common.veterinario": "Veterinarian",
    "common.sucursal":    "Branch",
    "common.pagina":      "Page",
  },

  "pt-BR": {
    "error.validation":       "Erro de validação",
    "error.not_found":        "Não encontrado",
    "error.forbidden":        "Sem permissão para realizar esta ação",
    "error.auth_required":    "Autenticação necessária",
    "error.rate_limited":     "Muitas tentativas. Tente novamente mais tarde",
    "error.plan_required":    "Esta função requer um plano superior",
    "error.conflict":         "Conflito com dados existentes",
    "error.internal":         "Erro interno do servidor",
    "error.tenant_not_found": "Clínica não encontrada",

    "notif.vacuna.titulo":    "Lembrete de vacina — {{paciente}}",
    "notif.vacuna.cuerpo":    "A vacina {{vacuna}} de {{paciente}} vence em {{fecha}}. Não esqueça de renovar.",
    "notif.turno.titulo":     "Lembrete de consulta",
    "notif.turno.cuerpo":     "Amanhã você tem consulta para {{paciente}} com {{veterinario}} às {{hora}}.",
    "notif.desparasitacion.titulo": "Lembrete de vermifugação",
    "notif.desparasitacion.cuerpo": "Está na hora da vermifugação de {{paciente}} com {{produto}}.",

    "email.reset_password.subject": "Redefinir senha — VetPro",
    "email.reset_password.body":    "Clique no link abaixo para redefinir sua senha. O link expira em 1 hora.",
    "email.welcome.subject":        "Bem-vindo ao VetPro, {{nome}}",
    "email.welcome.body":           "Sua conta foi criada com sucesso. Você pode entrar com seu e-mail e senha.",
    "email.factura.subject":        "Nova fatura disponível — {{numero}}",

    "pdf.ficha.titulo":   "Prontuário do Paciente",
    "pdf.receta.titulo":  "Receita Médica Veterinária",
    "pdf.vacuna.titulo":  "Certificado de Vacinação",
    "pdf.valida_hasta":   "Válida até",
    "common.generado_el": "Gerado em",
    "common.propietario": "Proprietário(a)",
    "common.veterinario": "Veterinário(a)",
    "common.sucursal":    "Filial",
    "common.pagina":      "Página",
  },
};

// ── Clase I18n ────────────────────────────────────────────────────────────────

export class I18n {
  static readonly SUPPORTED: SupportedLocale[] = ["es-AR", "en-US", "pt-BR"];
  static readonly DEFAULT: SupportedLocale = "es-AR";

  /**
   * Detecta el locale del request en este orden:
   * 1. ?locale= query param
   * 2. ctx.locale (del user en DB)
   * 3. Accept-Language header
   * 4. Default (es-AR)
   */
  static fromRequest(req: Request): SupportedLocale {
    // 1. query param explícito
    if (req.query.locale) {
      const q = String(req.query.locale);
      if (this.isSupported(q)) return q as SupportedLocale;
    }

    // 2. locale del contexto (user en DB)
    const ctxLocale = (req as any).ctx?.locale;
    if (ctxLocale && this.isSupported(ctxLocale)) return ctxLocale as SupportedLocale;

    // 3. Accept-Language header
    const accept = req.headers["accept-language"];
    if (accept) {
      const parsed = this.parseAcceptLanguage(accept);
      for (const lang of parsed) {
        if (this.isSupported(lang)) return lang as SupportedLocale;
        // Intento con solo el código de idioma: "es" → "es-AR"
        const fallback = this.SUPPORTED.find(s => s.startsWith(lang.slice(0, 2)));
        if (fallback) return fallback;
      }
    }

    return this.DEFAULT;
  }

  static isSupported(locale: string): boolean {
    return this.SUPPORTED.includes(locale as SupportedLocale);
  }

  /**
   * Traduce una clave con interpolación de variables.
   * @example t("notif.vacuna.cuerpo", "es-AR", { paciente: "Firulais", vacuna: "Antirrábica", fecha: "01/04/2026" })
   */
  static t(key: TranslationKey, locale: SupportedLocale, vars?: Record<string, string>): string {
    const catalog = TRANSLATIONS[locale] ?? TRANSLATIONS[this.DEFAULT];
    let text = catalog[key] ?? TRANSLATIONS[this.DEFAULT][key] ?? key;

    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{{${k}}}`, v);
      }
    }

    return text;
  }

  /**
   * Formatea una fecha según el locale.
   */
  static formatDate(date: Date | string, locale: SupportedLocale, opts?: Intl.DateTimeFormatOptions): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const intlLocale = locale.replace("-", "_");
    return new Intl.DateTimeFormat(intlLocale, opts ?? { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  }

  /**
   * Formatea moneda según locale.
   * @param cents — valor en centavos
   */
  static formatMoney(cents: number, locale: SupportedLocale): string {
    const amount = cents / 100;
    const currency = locale === "pt-BR" ? "BRL" : "ARS";
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }

  /**
   * Formatea un número según locale (separadores de miles y decimales).
   */
  static formatNumber(n: number, locale: SupportedLocale, decimals = 2): string {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  }

  // ── Privado ────────────────────────────────────────────────────────────────

  private static parseAcceptLanguage(header: string): string[] {
    return header
      .split(",")
      .map(part => {
        const [lang, q] = part.trim().split(";q=");
        return { lang: lang.trim(), q: parseFloat(q ?? "1") };
      })
      .sort((a, b) => b.q - a.q)
      .map(({ lang }) => lang);
  }
}

// ── Middleware Express: inyecta i18n en req ───────────────────────────────────

export function i18nMiddleware() {
  return (req: Request, _res: any, next: any) => {
    (req as any).locale = I18n.fromRequest(req);
    (req as any).t = (key: TranslationKey, vars?: Record<string, string>) =>
      I18n.t(key, (req as any).locale, vars);
    next();
  };
}

// ── Helper de conveniencia ────────────────────────────────────────────────────

export function getLocale(req: Request): SupportedLocale {
  return (req as any).locale ?? I18n.DEFAULT;
}

export function t(req: Request, key: TranslationKey, vars?: Record<string, string>): string {
  return I18n.t(getLocale(req), key, vars);
}
