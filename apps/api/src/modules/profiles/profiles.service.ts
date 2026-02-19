import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole, VendorType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateIndividualProfileDto } from './dto/update-individual-profile.dto';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async getMe(userId: string, role: UserRole) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        individualProfile: true,
        companyProfile: true,
        vendorProfile: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const profile = this.getProfileByRole(user);
    const p = profile as { avatarKey?: string; showreelKey?: string; logoKey?: string } | null;
    const avatarKey = p?.avatarKey ?? p?.logoKey;
    const avatarUrl = avatarKey
      ? (await this.storage.getSignedUrl(avatarKey)) ?? this.storage.getPublicUrl(avatarKey)
      : null;
    const showreelUrl = p?.showreelKey
      ? (await this.storage.getSignedUrl(p.showreelKey)) ?? this.storage.getPublicUrl(p.showreelKey)
      : null;
    const logoUrl = p?.logoKey
      ? (await this.storage.getSignedUrl(p.logoKey)) ?? this.storage.getPublicUrl(p.logoKey)
      : null;
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isVerified: user.isVerified,
      profile: profile ? { ...profile, avatarUrl, showreelUrl: showreelUrl ?? undefined, logoUrl: logoUrl ?? undefined } : null,
    };
  }

  private getProfileByRole(user: {
    individualProfile: unknown;
    companyProfile: unknown;
    vendorProfile: unknown;
    role: UserRole;
  }) {
    if (user.role === UserRole.individual) return user.individualProfile;
    if (user.role === UserRole.company) return user.companyProfile;
    if (user.role === UserRole.vendor) return user.vendorProfile;
    return null;
  }

  async updateIndividual(userId: string, dto: UpdateIndividualProfileDto) {
    await this.ensureRole(userId, UserRole.individual);
    const existing = await this.prisma.individualProfile.findUnique({ where: { userId } });
    const data = {
      displayName: dto.displayName,
      bio: dto.bio,
      skills: dto.skills,
      locationCity: dto.locationCity,
      locationState: dto.locationState,
      lat: dto.lat,
      lng: dto.lng,
      dailyRateMin: dto.dailyRateMin,
      dailyRateMax: dto.dailyRateMax,
      imdbUrl: dto.imdbUrl,
      instagramUrl: dto.instagramUrl,
      isAvailable: dto.isAvailable,
    };
    const filtered = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (existing) {
      return this.prisma.individualProfile.update({
        where: { userId },
        data: filtered,
      });
    }
    return this.prisma.individualProfile.create({
      data: {
        userId,
        displayName: dto.displayName ?? 'Unknown',
        ...filtered,
      },
    });
  }

  async updateCompany(userId: string, dto: UpdateCompanyProfileDto) {
    await this.ensureRole(userId, UserRole.company);
    const existing = await this.prisma.companyProfile.findUnique({ where: { userId } });
    const data = {
      companyName: dto.companyName,
      gstNumber: dto.gstNumber,
      panNumber: dto.panNumber,
      companyType: dto.companyType,
      website: dto.website,
    };
    const filtered = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (existing) {
      return this.prisma.companyProfile.update({
        where: { userId },
        data: filtered,
      });
    }
    return this.prisma.companyProfile.create({
      data: {
        userId,
        companyName: dto.companyName ?? 'Unknown',
        ...filtered,
      },
    });
  }

  async updateVendor(userId: string, dto: UpdateVendorProfileDto) {
    await this.ensureRole(userId, UserRole.vendor);
    const existing = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    const data = {
      companyName: dto.companyName,
      vendorType: dto.vendorType,
      gstNumber: dto.gstNumber,
    };
    const filtered = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (existing) {
      return this.prisma.vendorProfile.update({
        where: { userId },
        data: filtered,
      });
    }
    return this.prisma.vendorProfile.create({
      data: {
        userId,
        companyName: dto.companyName ?? 'Unknown',
        vendorType: dto.vendorType ?? VendorType.equipment,
        ...filtered,
      },
    });
  }

  private async ensureRole(userId: string, role: UserRole) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user || user.role !== role) {
      throw new ForbiddenException('Not allowed for your role');
    }
  }

  async getPublicProfile(viewerId: string, viewerRole: UserRole, targetUserId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null, isActive: true },
      include: {
        individualProfile: true,
        companyProfile: true,
        vendorProfile: true,
      },
    });
    if (!target) throw new NotFoundException('User not found');
    const profile = this.getProfileByRole(target);
    if (!profile) return { id: target.id, role: target.role, profile: null };

    const maskRates = viewerRole !== UserRole.company;
    const base = profile as Record<string, unknown>;
    let sanitized = { ...base };
    if (maskRates && 'dailyRateMin' in base) {
      sanitized = { ...sanitized, dailyRateMin: undefined, dailyRateMax: undefined };
    }
    const avatarUrl = base.avatarKey
      ? await this.storage.getSignedUrl(base.avatarKey as string) ?? this.storage.getPublicUrl(base.avatarKey as string)
      : null;
    const showreelUrl = base.showreelKey
      ? await this.storage.getSignedUrl(base.showreelKey as string) ?? this.storage.getPublicUrl(base.showreelKey as string)
      : null;
    const logoUrl = base.logoKey
      ? await this.storage.getSignedUrl(base.logoKey as string) ?? this.storage.getPublicUrl(base.logoKey as string)
      : null;
    return {
      id: target.id,
      role: target.role,
      profile: { ...sanitized, avatarUrl, showreelUrl, logoUrl },
    };
  }

  async getPresignedAvatarUrl(userId: string): Promise<{ uploadUrl: string; key: string }> {
    if (!this.storage.isConfigured()) {
      throw new Error('Storage (S3) is not configured. Set AWS_S3_BUCKET and credentials.');
    }
    const key = `avatars/${userId}/${Date.now()}`;
    return this.storage.getPresignedPutUrl(key, 'image/jpeg');
  }

  async setAvatarKey(userId: string, key: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.individual) {
      await this.prisma.individualProfile.upsert({
        where: { userId },
        create: { userId, displayName: 'Unknown', avatarKey: key },
        update: { avatarKey: key },
      });
    } else if (user.role === UserRole.company) {
      await this.prisma.companyProfile.upsert({
        where: { userId },
        create: { userId, companyName: 'Unknown', logoKey: key },
        update: { logoKey: key },
      });
    } else if (user.role === UserRole.vendor) {
      await this.prisma.vendorProfile.upsert({
        where: { userId },
        create: { userId, companyName: 'Unknown', vendorType: VendorType.equipment, logoKey: key },
        update: { logoKey: key },
      });
    }
    return { key };
  }

  async getPresignedShowreelUrl(userId: string): Promise<{ uploadUrl: string; key: string }> {
    await this.ensureRole(userId, UserRole.individual);
    if (!this.storage.isConfigured()) {
      throw new Error('Storage (S3) is not configured.');
    }
    const key = `showreels/${userId}/${Date.now()}.mp4`;
    return this.storage.getPresignedPutUrl(key, 'video/mp4');
  }

  async setShowreelKey(userId: string, key: string) {
    await this.ensureRole(userId, UserRole.individual);
    await this.prisma.individualProfile.upsert({
      where: { userId },
      create: { userId, displayName: 'Unknown', showreelKey: key },
      update: { showreelKey: key },
    });
    return { key };
  }
}
