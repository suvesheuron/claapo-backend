import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';
import { UserRole, OtpType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppCacheService } from '../../common/cache/app-cache.service';
import { SmsService } from '../sms/sms.service';
import { EmailService } from '../email/email.service';
import { RegisterIndividualDto } from './dto/register-individual.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { RegisterVendorDto } from './dto/register-vendor.dto';
import { RegisterCastDto } from './dto/register-cast.dto';
import { LoginDto } from './dto/login.dto';

const BCRYPT_ROUNDS = 12;
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 5;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly cache: AppCacheService,
    private readonly sms: SmsService,
    private readonly email: EmailService,
  ) {}

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  private generateOtp(): string {
    const digits = '0123456789';
    let otp = '';
    const random = randomBytes(OTP_LENGTH);
    for (let i = 0; i < OTP_LENGTH; i++) {
      otp += digits[random[i]! % 10];
    }
    return otp;
  }

  /**
   * HMAC-SHA256 with a server-side secret. Sync, constant-time, no threadpool —
   * roughly 1000x faster than the bcrypt cost-12 it replaces, which matters
   * because sendOtp ran on a hot path before SMS retries even start.
   * The OTP itself only lives 5 minutes, so we don't need bcrypt-grade KDF
   * stretching here — the secret prevents offline rainbow lookup against the
   * 10^6 6-digit space if the DB is exfiltrated, and that's the whole threat.
   */
  private hashOtp(otp: string): string {
    const secret = this.config.get<string>('otpHmacSecret') ?? '';
    return createHmac('sha256', secret).update(otp).digest('hex');
  }

  private verifyOtp(otp: string, hash: string): boolean {
    const candidate = this.hashOtp(otp);
    if (candidate.length !== hash.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
  }

  /** Include plaintext OTP in JSON when SMS is not wired (dev/staging demos). Never enabled in production unless EXPOSE_OTP_IN_API is set. */
  private exposeOtpInApi(): boolean {
    if (this.config.get<boolean>('exposeOtpInApi')) return true;
    return this.config.get<string>('env') !== 'production';
  }

  async registerIndividual(dto: RegisterIndividualDto): Promise<{ userId: string; message: string }> {
    await this.ensureEmailPhoneAvailable(dto.email, dto.phone);
    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: UserRole.individual,
      },
    });
    return { userId: user.id, message: 'Registration successful. Verify OTP to activate.' };
  }

  async registerCompany(dto: RegisterCompanyDto): Promise<{ userId: string; message: string }> {
    await this.ensureEmailPhoneAvailable(dto.email, dto.phone);
    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: UserRole.company,
        companyProfile: {
          create: {
            companyName: 'Unknown',
            gstNumber: dto.gstNumber?.trim() || null,
          },
        },
      },
    });
    return { userId: user.id, message: 'Registration successful. Verify OTP to activate.' };
  }

  async registerVendor(dto: RegisterVendorDto): Promise<{ userId: string; message: string }> {
    await this.ensureEmailPhoneAvailable(dto.email, dto.phone);
    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: UserRole.vendor,
      },
    });
    return { userId: user.id, message: 'Registration successful. Verify OTP to activate.' };
  }

  async registerCast(dto: RegisterCastDto): Promise<{ userId: string; message: string }> {
    await this.ensureEmailPhoneAvailable(dto.email, dto.phone);
    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: UserRole.cast,
        displayName: dto.displayName,
        castProfile: {
          create: {
            displayName: dto.displayName,
            roleType: dto.roleType,
            age: dto.age ?? null,
            gender: dto.gender ?? null,
            locationCity: dto.locationCity ?? null,
          },
        },
      },
    });
    return { userId: user.id, message: 'Registration successful. Verify OTP to activate.' };
  }

  private async ensureEmailPhoneAvailable(email: string, phone: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone }], deletedAt: null },
    });
    if (existing) {
      if (existing.email === email) throw new ConflictException('Email already registered');
      throw new ConflictException('Phone already registered');
    }
  }

  async sendOtp(phone: string): Promise<{ message: string; devOtp?: string }> {
    const user = await this.prisma.user.findFirst({ where: { phone, deletedAt: null } });
    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await this.prisma.otpSession.create({
      data: {
        userId: user?.id ?? undefined,
        otpHash,
        type: OtpType.registration,
        expiresAt,
      },
    });
    await this.sms.sendOtp(phone, otp);
    if (this.config.get('env') === 'development') {
      console.log(`[DEV] OTP for ${phone}: ${otp} (expires in ${OTP_EXPIRY_MINUTES} min)`);
    }
    if (this.exposeOtpInApi()) {
      return { message: 'OTP sent successfully', devOtp: otp };
    }
    return { message: 'OTP sent successfully' };
  }

  async verifyOtpAndLogin(phone: string, otp: string): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({
      where: { phone, deletedAt: null },
    });
    if (!user) throw new BadRequestException('No user found for this phone. Register first.');

    const sessions = await this.prisma.otpSession.findMany({
      where: {
        type: OtpType.registration,
        usedAt: null,
        expiresAt: { gt: new Date() },
        OR: [{ userId: user.id }, { userId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    let matched = false;
    for (const s of sessions) {
      if (this.verifyOtp(otp, s.otpHash)) {
        matched = true;
        await this.prisma.otpSession.update({
          where: { id: s.id },
          data: { usedAt: new Date() },
        });
        break;
      }
    }
    if (!matched) throw new BadRequestException('Invalid or expired OTP');
    if (!user.isActive) throw new UnauthorizedException('Account is deactivated');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });
    const userWithMain = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, role: true, displayName: true, mainUserId: true },
    });
    return this.issueTokenPair(userWithMain!);
  }

  async sendOtpEmail(email: string): Promise<{ message: string; devOtp?: string }> {
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    // Same generic-response pattern as phone OTP — don't leak whether the email
    // exists. The OtpSession row is created either way to keep timing similar.
    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await this.prisma.otpSession.create({
      data: {
        userId: user?.id ?? undefined,
        otpHash,
        type: OtpType.registration,
        expiresAt,
      },
    });
    if (user) {
      await this.email.sendOtp(email, otp);
    }
    if (this.config.get('env') === 'development') {
      console.log(`[DEV] Email OTP for ${email}: ${otp} (expires in ${OTP_EXPIRY_MINUTES} min)`);
    }
    if (this.exposeOtpInApi()) {
      return { message: 'OTP sent successfully', devOtp: otp };
    }
    return { message: 'OTP sent successfully' };
  }

  async verifyOtpEmailAndLogin(email: string, otp: string): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
    if (!user) throw new BadRequestException('No user found for this email. Register first.');

    const sessions = await this.prisma.otpSession.findMany({
      where: {
        type: OtpType.registration,
        usedAt: null,
        expiresAt: { gt: new Date() },
        OR: [{ userId: user.id }, { userId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    let matched = false;
    for (const s of sessions) {
      if (this.verifyOtp(otp, s.otpHash)) {
        matched = true;
        await this.prisma.otpSession.update({
          where: { id: s.id },
          data: { usedAt: new Date() },
        });
        break;
      }
    }
    if (!matched) throw new BadRequestException('Invalid or expired OTP');
    if (!user.isActive) throw new UnauthorizedException('Account is deactivated');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });
    const userWithMain = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, role: true, displayName: true, mainUserId: true },
    });
    return this.issueTokenPair(userWithMain!);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });
    if (!user || !(await this.verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) throw new UnauthorizedException('Account is deactivated');
    const userWithMain = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, role: true, displayName: true, mainUserId: true },
    });
    return this.issueTokenPair(userWithMain!);
  }

  private async issueTokenPair(user: { id: string; email: string; role: UserRole; displayName?: string | null; mainUserId?: string | null }): Promise<TokenPair> {
    const payload = { sub: user.id, email: user.email, role: user.role, displayName: user.displayName || null, mainUserId: user.mainUserId || null };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.config.get<string>('jwt.expiresIn'),
    });
    const family = createHash('sha256').update(randomBytes(32)).digest('hex').slice(0, 32);
    const rawRefresh = randomBytes(32).toString('hex');
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn') ?? '7d';
    const refreshExpiresMs = this.parseExpiryToMs(refreshExpiresIn);
    const expiresAt = new Date(Date.now() + refreshExpiresMs);
    const tokenHash = createHash('sha256').update(rawRefresh).digest('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        family,
        expiresAt,
      },
    });
    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresIn: this.parseExpiryToSeconds(this.config.get<string>('jwt.expiresIn') ?? '15m'),
    };
  }

  private parseExpiryToMs(exp: string): number {
    const match = exp.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const n = parseInt(match[1]!, 10);
    const u = match[2]!;
    const multipliers: Record<string, number> = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 86400 * 1000 };
    return n * (multipliers[u] ?? 86400 * 1000);
  }

  private parseExpiryToSeconds(exp: string): number {
    return Math.floor(this.parseExpiryToMs(exp) / 1000);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    const token = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: hash, revoked: false, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!token) throw new UnauthorizedException('Invalid or expired refresh token');
    await this.prisma.refreshToken.update({ where: { id: token.id }, data: { revoked: true } });
    const user = token.user;
    if (user.deletedAt || !user.isActive) throw new UnauthorizedException('Account unavailable');
    const userWithMain = {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      mainUserId: user.mainUserId,
    };
    return this.issueTokenPair(userWithMain);
  }

  async logout(userId: string, refreshToken?: string): Promise<{ message: string }> {
    if (refreshToken) {
      const hash = createHash('sha256').update(refreshToken).digest('hex');
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash: hash },
        data: { revoked: true },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId },
        data: { revoked: true },
      });
    }
    return { message: 'Logged out successfully' };
  }

  async passwordResetRequest(phone: string): Promise<{ message: string; devOtp?: string }> {
    const user = await this.prisma.user.findFirst({ where: { phone, deletedAt: null } });
    const genericMsg = 'If this number is registered, you will receive an OTP.';
    if (!user) return { message: genericMsg };
    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await this.prisma.otpSession.create({
      data: { userId: user.id, otpHash, type: OtpType.password_reset, expiresAt },
    });
    await this.sms.sendOtp(phone, otp);
    if (this.config.get('env') === 'development') {
      console.log(`[DEV] Password reset OTP for ${phone}: ${otp}`);
    }
    if (this.exposeOtpInApi()) {
      return { message: genericMsg, devOtp: otp };
    }
    return { message: genericMsg };
  }

  async passwordResetRequestEmail(email: string): Promise<{ message: string; devOtp?: string }> {
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    const genericMsg = 'If this email is registered, you will receive an OTP.';
    if (!user) return { message: genericMsg };
    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await this.prisma.otpSession.create({
      data: { userId: user.id, otpHash, type: OtpType.password_reset, expiresAt },
    });
    await this.email.sendOtp(email, otp);
    if (this.config.get('env') === 'development') {
      console.log(`[DEV] Password reset OTP for ${email}: ${otp}`);
    }
    if (this.exposeOtpInApi()) {
      return { message: genericMsg, devOtp: otp };
    }
    return { message: genericMsg };
  }

  async passwordResetConfirmEmail(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (!user) throw new BadRequestException('User not found');
    const sessions = await this.prisma.otpSession.findMany({
      where: { userId: user.id, type: OtpType.password_reset, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    let matched = false;
    for (const s of sessions) {
      if (this.verifyOtp(otp, s.otpHash)) {
        matched = true;
        await this.prisma.otpSession.update({ where: { id: s.id }, data: { usedAt: new Date() } });
        break;
      }
    }
    if (!matched) throw new BadRequestException('Invalid or expired OTP');
    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    return { message: 'Password reset successful' };
  }

  async passwordResetConfirm(
    phone: string,
    otp: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({ where: { phone, deletedAt: null } });
    if (!user) throw new BadRequestException('User not found');
    const sessions = await this.prisma.otpSession.findMany({
      where: { userId: user.id, type: OtpType.password_reset, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    let matched = false;
    for (const s of sessions) {
      if (this.verifyOtp(otp, s.otpHash)) {
        matched = true;
        await this.prisma.otpSession.update({ where: { id: s.id }, data: { usedAt: new Date() } });
        break;
      }
    }
    if (!matched) throw new BadRequestException('Invalid or expired OTP');
    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    return { message: 'Password reset successful' };
  }

  async validateUser(payload: AuthUser): Promise<AuthUser | null> {
    // validateUser runs in the JWT guard, so every authenticated request hits
    // it. A typical page mount fires 5–8 API calls in parallel, each of which
    // would otherwise spend a Prisma connection here — enough to drain the
    // 17-connection pool when other queries pile on (we saw a pool timeout in
    // production logs). Cache the active-user identity for a short TTL so the
    // guard becomes a Redis lookup instead of a DB roundtrip on the hot path.
    // The TTL is intentionally short (60s) so deactivated / soft-deleted users
    // lose access quickly without needing an explicit invalidate.
    return this.cache.wrap(
      `auth:validate:${payload.id}`,
      60,
      async () => {
        const user = await this.prisma.user.findFirst({
          where: { id: payload.id, deletedAt: null, isActive: true },
          select: { id: true, email: true, role: true },
        });
        if (!user) return null;
        return { id: user.id, email: user.email, role: user.role };
      },
    );
  }
}
