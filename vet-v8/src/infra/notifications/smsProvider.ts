import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { AppError } from "../../core/errors/appError.js";
import { type AppConfig } from "../../config/types.js";

export type SmsMessage = { to: string; message: string };

export function buildSmsProvider(config: AppConfig) {
  const sns = new SNSClient({ region: config.snsRegion || config.s3Region });
  async function send(msg: SmsMessage) {
    if (!msg.to || !msg.message) throw new AppError("VALIDATION_ERROR", "to and message required");
    const attrs: any = {};
    if (config.snsSenderId) attrs.AWS_SNS_SMS_SENDER_ID = { DataType: "String", StringValue: config.snsSenderId };
    await sns.send(new PublishCommand({
      PhoneNumber: msg.to,
      Message: msg.message,
      MessageAttributes: Object.keys(attrs).length ? attrs : undefined,
    }));
    return { ok: true };
  }
  return { send };
}
