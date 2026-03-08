import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { AppError } from "../../core/errors/appError.js";
import { type AppConfig } from "../../config/types.js";

export type EmailMessage = { to: string; subject: string; bodyText: string; bodyHtml?: string };

export function buildEmailProvider(config: AppConfig) {
  const ses = new SESClient({ region: config.s3Region }); // reuse region; override via AWS_REGION if needed
  const from = config.sesFromEmail;

  async function send(msg: EmailMessage) {
    if (!from) throw new AppError("CONFIG_ERROR", "SES_FROM_EMAIL is required to send email");
    await ses.send(new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [msg.to] },
      Message: {
        Subject: { Data: msg.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: msg.bodyText, Charset: "UTF-8" },
          ...(msg.bodyHtml ? { Html: { Data: msg.bodyHtml, Charset: "UTF-8" } } : {})
        }
      }
    }));
    return { ok: true };
  }

  return { send };
}
