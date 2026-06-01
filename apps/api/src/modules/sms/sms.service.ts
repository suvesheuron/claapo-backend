import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Msg91Config {
  authKey: string;
  templateId: string;
  senderId?: string;
  baseUrl: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  private getMsg91Config(): Msg91Config | null {
    const authKey = this.config.get<string>('msg91.authKey');
    const templateId = this.config.get<string>('msg91.templateId');
    if (!authKey || !templateId) return null;
    return {
      authKey,
      templateId,
      senderId: this.config.get<string>('msg91.senderId') || undefined,
      baseUrl: this.config.get<string>('msg91.baseUrl') ?? 'https://control.msg91.com/api/v5',
    };
  }

  /**
   * Send an OTP SMS via MSG91 with the OTP value we generated locally.
   * Returns true on success, false if MSG91 isn't configured or delivery failed.
   * Failures are logged but never thrown — sendOtp should still succeed from
   * the caller's perspective (devOtp fallback covers staging).
   */
  async sendOtp(phone: string, otp: string): Promise<boolean> {
    const cfg = this.getMsg91Config();
    if (!cfg) {
      this.logger.warn(`MSG91 not configured — skipping SMS send to ${this.maskPhone(phone)}`);
      return false;
    }

    const mobile = this.normalizePhone(phone);
    const url = new URL(`${cfg.baseUrl}/otp`);
    url.searchParams.set('template_id', cfg.templateId);
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('otp', otp);
    url.searchParams.set('otp_expiry', '5');
    if (cfg.senderId) url.searchParams.set('sender', cfg.senderId);

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authkey: cfg.authKey,
        },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        type?: string;
        message?: string;
        request_id?: string;
      };
      if (!res.ok || body.type === 'error') {
        this.logger.error(
          `MSG91 OTP send failed for ${this.maskPhone(phone)}: ${res.status} ${body.message ?? 'unknown'}`,
        );
        return false;
      }
      this.logger.log(`MSG91 OTP sent to ${this.maskPhone(phone)} (request_id=${body.request_id ?? 'n/a'})`);
      return true;
    } catch (err) {
      this.logger.error(`MSG91 OTP send threw for ${this.maskPhone(phone)}: ${(err as Error).message}`);
      return false;
    }
  }

  /** MSG91 expects E.164 without "+" — e.g. "919876543210". Assume India (91) if no country code. */
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `91${digits}`;
    return digits;
  }

  private maskPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return '****';
    return `${digits.slice(0, 2)}****${digits.slice(-2)}`;
  }
}
