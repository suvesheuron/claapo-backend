import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: SESv2Client | null;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly replyTo: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('ses.region') ?? 'ap-south-1';
    this.fromEmail = this.config.get<string>('ses.fromEmail') ?? '';
    this.fromName = this.config.get<string>('ses.fromName') ?? 'Claapo';
    this.replyTo = this.config.get<string>('ses.replyTo') ?? '';

    // Lazy-construct only when configured. Lets dev environments boot without
    // SES credentials — sendOtp will fall back to logging.
    if (this.fromEmail) {
      this.client = new SESv2Client({ region });
    } else {
      this.client = null;
    }
  }

  /**
   * Send an OTP email. Returns true on success.
   * On failure (SES misconfigured, sandbox rejection, network), logs and
   * returns false — caller continues with devOtp fallback so auth flow
   * isn't blocked on email delivery.
   */
  async sendOtp(toEmail: string, otp: string): Promise<boolean> {
    if (!this.client || !this.fromEmail) {
      this.logger.warn(`SES not configured — skipping email to ${this.maskEmail(toEmail)}`);
      return false;
    }

    const subject = `${otp} is your Claapo verification code`;
    const html = this.buildOtpHtml(otp);
    const text = this.buildOtpText(otp);

    try {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: `${this.fromName} <${this.fromEmail}>`,
          ReplyToAddresses: this.replyTo ? [this.replyTo] : undefined,
          Destination: { ToAddresses: [toEmail] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: html, Charset: 'UTF-8' },
                Text: { Data: text, Charset: 'UTF-8' },
              },
            },
          },
        }),
      );
      this.logger.log(`SES OTP sent to ${this.maskEmail(toEmail)} (messageId=${result.MessageId})`);
      return true;
    } catch (err) {
      const e = err as Error & { name?: string };
      this.logger.error(`SES OTP send failed for ${this.maskEmail(toEmail)}: ${e.name ?? 'Error'} ${e.message}`);
      return false;
    }
  }

  private buildOtpHtml(otp: string): string {
    return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a202c;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 16px;">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;max-width:100%;">
            <tr><td style="font-size:20px;font-weight:600;padding-bottom:8px;">Verify your email</td></tr>
            <tr><td style="font-size:14px;color:#4a5568;padding-bottom:24px;">Use this code to finish signing in to Claapo:</td></tr>
            <tr><td align="center" style="background:#f0f3ff;border-radius:8px;padding:20px;font-size:32px;font-weight:700;letter-spacing:8px;color:#3B5BDB;font-family:monospace;">${otp}</td></tr>
            <tr><td style="font-size:13px;color:#718096;padding-top:24px;">This code expires in 5 minutes. If you didn't request it, you can safely ignore this email.</td></tr>
            <tr><td style="font-size:12px;color:#a0aec0;padding-top:24px;border-top:1px solid #edf2f7;margin-top:24px;">Claapo — film production crew marketplace</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  private buildOtpText(otp: string): string {
    return `Your Claapo verification code is: ${otp}\n\nThis code expires in 5 minutes. If you didn't request it, you can safely ignore this email.\n\n— Claapo`;
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '****';
    const visible = local.slice(0, 2);
    return `${visible}***@${domain}`;
  }
}
