import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { UserRole, OtpType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_SMS, DEFAULT_JOB_OPTS } from '../../queue/queue.constants';
import type { SmsJobPayload } from '../../queue/job-payloads';
import { RegisterIndividualDto } from './dto/register-individual.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { RegisterVendorDto } from './dto/register-vendor.dto';
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
    @InjectQueue(QUEUE_SMS) private readonly smsQueue: Queue,
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

  private async hashOtp(otp: string): Promise<string> {
    return bcrypt.hash(otp, 10);
  }

  private async verifyOtp(otp: string, hash: string): Promise<boolean> {
    return bcrypt.compare(otp, hash);
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

  private async ensureEmailPhoneAvailable(email: string, phone: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone }], deletedAt: null },
    });
    if (existing) {
      if (existing.email === email) throw new ConflictException('Email already registered');
      throw new ConflictException('Phone already registered');
    }
  }

  async sendOtp(phone: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({ where: { phone, deletedAt: null } });
    const otp = this.generateOtp();
    const otpHash = await this.hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await this.prisma.otpSession.create({
      data: {
        userId: user?.id ?? undefined,
        otpHash,
        type: OtpType.registration,
        expiresAt,
      },
    });
    const payload: SmsJobPayload = { phone, otp, type: 'registration' };
    await this.smsQueue.add('otp', payload, { priority: 1, ...DEFAULT_JOB_OPTS });
    if (this.config.get('env') === 'development') {
      console.log(`[DEV] OTP for ${phone}: ${otp} (expires in ${OTP_EXPIRY_MINUTES} min)`);
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
      if (await this.verifyOtp(otp, s.otpHash)) {
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
    return this.issueTokenPair(user);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });
    if (!user || !(await this.verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) throw new UnauthorizedException('Account is deactivated');
    return this.issueTokenPair(user);
  }

  private async issueTokenPair(user: { id: string; email: string; role: UserRole }): Promise<TokenPair> {
    const payload = { sub: user.id, email: user.email, role: user.role };
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
    return this.issueTokenPair(user);
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

  async passwordResetRequest(phone: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({ where: { phone, deletedAt: null } });
    if (!user) return { message: 'If this number is registered, you will receive an OTP.' };
    const otp = this.generateOtp();
    const otpHash = await this.hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await this.prisma.otpSession.create({
      data: { userId: user.id, otpHash, type: OtpType.password_reset, expiresAt },
    });
    const payload: SmsJobPayload = { phone, otp, type: 'password_reset' };
    await this.smsQueue.add('otp', payload, { priority: 1, ...DEFAULT_JOB_OPTS });
    if (this.config.get('env') === 'development') {
      console.log(`[DEV] Password reset OTP for ${phone}: ${otp}`);
    }
    return { message: 'If this number is registered, you will receive an OTP.' };
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
      if (await this.verifyOtp(otp, s.otpHash)) {
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
    const user = await this.prisma.user.findFirst({
      where: { id: payload.id, deletedAt: null, isActive: true },
    });
    if (!user) return null;
    return { id: user.id, email: user.email, role: user.role };
  }
}
