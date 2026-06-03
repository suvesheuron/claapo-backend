import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { UserRole, VendorType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateIndividualProfileDto } from './dto/update-individual-profile.dto';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UpdateCastProfileDto } from './dto/update-cast-profile.dto';
import { UpdateLocationProfileDto } from './dto/update-location-profile.dto';
import { CreateSubUserDto } from './dto/create-sub-user.dto';
import { CreateShowcaseItemDto } from './dto/create-showcase-item.dto';

type ShowcaseMediaType = 'image' | 'video' | 'document';

@Injectable()
export class ProfilesService {
  private static readonly SUB_USER_PASSWORD_ROUNDS = 12;
  private static readonly ALLOWED_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
  // Backwards-compat alias for any legacy reference inside this file.
  private static readonly ALLOWED_COVER_CONTENT_TYPES = ProfilesService.ALLOWED_IMAGE_CONTENT_TYPES;

  // Work Showcase accepts images, videos and documents (no audio). Each MIME
  // maps to the stored mediaType (how the client renders it) and the file
  // extension we write into the S3 key.
  private static readonly SHOWCASE_MIME_MAP: Record<string, { mediaType: ShowcaseMediaType; extension: string }> = {
    'image/jpeg': { mediaType: 'image', extension: 'jpg' },
    'image/jpg': { mediaType: 'image', extension: 'jpg' },
    'image/png': { mediaType: 'image', extension: 'png' },
    'image/webp': { mediaType: 'image', extension: 'webp' },
    'image/gif': { mediaType: 'image', extension: 'gif' },
    'video/mp4': { mediaType: 'video', extension: 'mp4' },
    'video/quicktime': { mediaType: 'video', extension: 'mov' },
    'video/webm': { mediaType: 'video', extension: 'webm' },
    'application/pdf': { mediaType: 'document', extension: 'pdf' },
    'application/msword': { mediaType: 'document', extension: 'doc' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { mediaType: 'document', extension: 'docx' },
    'application/vnd.ms-excel': { mediaType: 'document', extension: 'xls' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { mediaType: 'document', extension: 'xlsx' },
    'application/vnd.ms-powerpoint': { mediaType: 'document', extension: 'ppt' },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { mediaType: 'document', extension: 'pptx' },
    'text/plain': { mediaType: 'document', extension: 'txt' },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private normalizeOptionalText(value?: string | null): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private assertSacCodeRule(gstNumber?: string | null, sacCode?: string | null): void {
    if (gstNumber && !sacCode) {
      throw new BadRequestException('SAC code is required when GST number is provided.');
    }
  }

  async getMe(userId: string, role: UserRole) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        individualProfile: true,
        companyProfile: true,
        vendorProfile: true,
        castProfile: true,
        locationProfile: true,
        vendorEquipment: {
          include: {
            availabilities: {
              orderBy: { availableFrom: 'asc' },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const profile = this.getProfileByRole(user);
    const p = profile as { avatarKey?: string; coverKey?: string; showreelKey?: string; logoKey?: string } | null;
    const avatarKey = p?.avatarKey ?? p?.logoKey;
    const avatarUrl = avatarKey
      ? (await this.storage.getSignedUrl(avatarKey)) ?? this.storage.getPublicUrl(avatarKey)
      : null;
    const showreelUrl = p?.showreelKey
      ? (await this.storage.getSignedUrl(p.showreelKey)) ?? this.storage.getPublicUrl(p.showreelKey)
      : null;
    const coverUrl = p?.coverKey
      ? (await this.storage.getSignedUrl(p.coverKey)) ?? this.storage.getPublicUrl(p.coverKey)
      : null;
    const logoUrl = p?.logoKey
      ? (await this.storage.getSignedUrl(p.logoKey)) ?? this.storage.getPublicUrl(p.logoKey)
      : null;
    // Cast members get a Work Showcase (images/videos/documents) on their
    // profile in place of the single-video showreel.
    const showcaseItems = user.role === UserRole.cast ? await this.resolveShowcaseItems(user.id) : undefined;
    // Location providers embed their listed properties (signed photo/PDF URLs)
    // plus the profile-level "detailed PDF" so the owner's profile screen can
    // render everything in one fetch — the location analogue of vendor equipment.
    const locationProperties = user.role === UserRole.location ? await this.resolveLocationProperties(user.id) : undefined;
    const detailPdfKey = (profile as { detailPdfKey?: string | null } | null)?.detailPdfKey ?? null;
    const detailPdfUrl = detailPdfKey
      ? (await this.storage.getSignedUrl(detailPdfKey)) ?? this.storage.getPublicUrl(detailPdfKey)
      : null;
    const profilePayload = profile
      ? {
          ...profile,
          avatarUrl,
          coverUrl: coverUrl ?? undefined,
          coverType: this.coverTypeFromKey(p?.coverKey) ?? undefined,
          showreelUrl: showreelUrl ?? undefined,
          logoUrl: logoUrl ?? undefined,
          ...(showcaseItems ? { showcaseItems } : {}),
          ...(user.role === UserRole.vendor && (user as { vendorEquipment?: unknown[] }).vendorEquipment
            ? { equipment: (user as { vendorEquipment: unknown[] }).vendorEquipment }
            : {}),
          ...(user.role === UserRole.location ? { properties: locationProperties ?? [], detailPdfUrl: detailPdfUrl ?? undefined } : {}),
        }
      : null;
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      mainUserId: user.mainUserId ?? null,
      isMainUser: !user.mainUserId,
      isVerified: user.isVerified,
      profile: profilePayload,
    };
  }

  private getProfileByRole(user: {
    individualProfile: unknown;
    companyProfile: unknown;
    vendorProfile: unknown;
    castProfile?: unknown;
    locationProfile?: unknown;
    role: UserRole;
  }) {
    if (user.role === UserRole.individual) return user.individualProfile;
    if (user.role === UserRole.company) return user.companyProfile;
    if (user.role === UserRole.vendor) return user.vendorProfile;
    if (user.role === UserRole.cast) return user.castProfile ?? null;
    if (user.role === UserRole.location) return user.locationProfile ?? null;
    return null;
  }

  async updateIndividual(userId: string, dto: UpdateIndividualProfileDto) {
    await this.ensureRole(userId, UserRole.individual);
    const existing = await this.prisma.individualProfile.findUnique({ where: { userId } });
    const skillsNormalized = dto.skills?.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    const genresNormalized = dto.genres?.map((g) => String(g).trim()).filter(Boolean);
    const nextGstNumber = this.normalizeOptionalText(dto.gstNumber) ?? this.normalizeOptionalText(existing?.gstNumber ?? null) ?? null;
    const nextSacCode = this.normalizeOptionalText(dto.sacCode) ?? this.normalizeOptionalText((existing as { sacCode?: string | null } | null)?.sacCode ?? null) ?? null;
    this.assertSacCodeRule(nextGstNumber, nextSacCode);

    const normalizedGst = this.normalizeOptionalText(dto.gstNumber);
    const normalizedSac = normalizedGst === null ? null : this.normalizeOptionalText(dto.sacCode);
    const data = {
      displayName: dto.displayName,
      bio: dto.bio,
      aboutMe: dto.aboutMe,
      skills: skillsNormalized,
      genres: genresNormalized,
      address: dto.address,
      locationCity: dto.locationCity,
      locationState: dto.locationState,
      lat: dto.lat,
      lng: dto.lng,
      dailyBudget: dto.dailyBudget,
      website: dto.website,
      imdbUrl: dto.imdbUrl,
      instagramUrl: dto.instagramUrl,
      youtubeUrl: dto.youtubeUrl,
      vimeoUrl: dto.vimeoUrl,
      isAvailable: dto.isAvailable,
      panNumber: dto.panNumber,
      billingName: dto.billingName,
      gstNumber: normalizedGst,
      sacCode: normalizedSac,
      upiId: dto.upiId,
      bankAccountName: dto.bankAccountName,
      bankAccountNumber: dto.bankAccountNumber,
      ifscCode: dto.ifscCode,
      bankName: dto.bankName,
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
    const skillsNormalized = dto.skills?.map((s) => String(s).trim()).filter(Boolean);
    const nextGstNumber = this.normalizeOptionalText(dto.gstNumber) ?? this.normalizeOptionalText(existing?.gstNumber ?? null) ?? null;
    const nextSacCode = this.normalizeOptionalText(dto.sacCode) ?? this.normalizeOptionalText((existing as { sacCode?: string | null } | null)?.sacCode ?? null) ?? null;
    this.assertSacCodeRule(nextGstNumber, nextSacCode);

    const normalizedGst = this.normalizeOptionalText(dto.gstNumber);
    const normalizedSac = normalizedGst === null ? null : this.normalizeOptionalText(dto.sacCode);
    const data = {
      companyName: dto.companyName,
      gstNumber: normalizedGst,
      sacCode: normalizedSac,
      panNumber: dto.panNumber,
      companyType: dto.companyType,
      skills: skillsNormalized,
      website: dto.website,
      imdbUrl: dto.imdbUrl,
      instagramUrl: dto.instagramUrl,
      youtubeUrl: dto.youtubeUrl,
      vimeoUrl: dto.vimeoUrl,
      address: dto.address,
      locationCity: dto.locationCity,
      locationState: dto.locationState,
      bankAccountName: dto.bankAccountName,
      bankAccountNumber: dto.bankAccountNumber,
      ifscCode: dto.ifscCode,
      bankName: dto.bankName,
      bio: dto.bio,
      aboutUs: dto.aboutUs,
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
    const nextGstNumber = this.normalizeOptionalText(dto.gstNumber) ?? this.normalizeOptionalText(existing?.gstNumber ?? null) ?? null;
    const nextSacCode = this.normalizeOptionalText(dto.sacCode) ?? this.normalizeOptionalText((existing as { sacCode?: string | null } | null)?.sacCode ?? null) ?? null;
    this.assertSacCodeRule(nextGstNumber, nextSacCode);

    const normalizedGst = this.normalizeOptionalText(dto.gstNumber);
    const normalizedSac = normalizedGst === null ? null : this.normalizeOptionalText(dto.sacCode);
    const data = {
      companyName: dto.companyName,
      vendorType: dto.vendorType,
      vendorServiceCategory: dto.vendorServiceCategory,
      gstNumber: normalizedGst,
      sacCode: normalizedSac,
      panNumber: dto.panNumber,
      billingName: dto.billingName,
      website: dto.website,
      imdbUrl: dto.imdbUrl,
      instagramUrl: dto.instagramUrl,
      youtubeUrl: dto.youtubeUrl,
      vimeoUrl: dto.vimeoUrl,
      address: dto.address,
      locationCity: dto.locationCity,
      locationState: dto.locationState,
      bankAccountName: dto.bankAccountName,
      bankAccountNumber: dto.bankAccountNumber,
      ifscCode: dto.ifscCode,
      bankName: dto.bankName,
      upiId: dto.upiId,
      bio: dto.bio,
      aboutUs: dto.aboutUs,
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

  async updateCast(userId: string, dto: UpdateCastProfileDto) {
    await this.ensureRole(userId, UserRole.cast);
    const existing = await this.prisma.castProfile.findUnique({ where: { userId } });
    const extraSkillsNormalized = dto.extraSkills?.map((s) => String(s).trim()).filter(Boolean);
    const languagesNormalized = dto.languages?.map((l) => String(l).trim()).filter(Boolean);

    const nextGstNumber = this.normalizeOptionalText(dto.gstNumber) ?? this.normalizeOptionalText(existing?.gstNumber ?? null) ?? null;
    const nextSacCode = this.normalizeOptionalText(dto.sacCode) ?? this.normalizeOptionalText(existing?.sacCode ?? null) ?? null;
    this.assertSacCodeRule(nextGstNumber, nextSacCode);

    const normalizedGst = this.normalizeOptionalText(dto.gstNumber);
    const normalizedSac = normalizedGst === null ? null : this.normalizeOptionalText(dto.sacCode);
    const data = {
      displayName: dto.displayName,
      roleType: dto.roleType,
      age: dto.age,
      gender: dto.gender,
      heightCm: dto.heightCm,
      bodyType: dto.bodyType,
      skinTone: dto.skinTone,
      eyeColor: dto.eyeColor,
      lookType: dto.lookType,
      hairType: dto.hairType,
      languages: languagesNormalized,
      aboutMe: dto.aboutMe,
      bio: dto.bio,
      extraSkills: extraSkillsNormalized,
      dailyBudget: dto.dailyBudget,
      address: dto.address,
      locationCity: dto.locationCity,
      locationState: dto.locationState,
      website: dto.website,
      imdbUrl: dto.imdbUrl,
      instagramUrl: dto.instagramUrl,
      youtubeUrl: dto.youtubeUrl,
      vimeoUrl: dto.vimeoUrl,
      isAvailable: dto.isAvailable,
      panNumber: dto.panNumber,
      billingName: dto.billingName,
      gstNumber: normalizedGst,
      sacCode: normalizedSac,
      upiId: dto.upiId,
      bankAccountName: dto.bankAccountName,
      bankAccountNumber: dto.bankAccountNumber,
      ifscCode: dto.ifscCode,
      bankName: dto.bankName,
    };
    const filtered = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (existing) {
      return this.prisma.castProfile.update({
        where: { userId },
        data: filtered,
      });
    }
    return this.prisma.castProfile.create({
      data: {
        userId,
        displayName: dto.displayName ?? 'Unknown',
        roleType: dto.roleType ?? 'actor',
        ...filtered,
      },
    });
  }

  async updateLocation(userId: string, dto: UpdateLocationProfileDto) {
    await this.ensureRole(userId, UserRole.location);
    const existing = await this.prisma.locationProfile.findUnique({ where: { userId } });
    const subTypesNormalized = dto.subTypes?.map((s) => String(s).trim()).filter(Boolean);

    const nextGstNumber = this.normalizeOptionalText(dto.gstNumber) ?? this.normalizeOptionalText(existing?.gstNumber ?? null) ?? null;
    const nextSacCode = this.normalizeOptionalText(dto.sacCode) ?? this.normalizeOptionalText(existing?.sacCode ?? null) ?? null;
    this.assertSacCodeRule(nextGstNumber, nextSacCode);

    const normalizedGst = this.normalizeOptionalText(dto.gstNumber);
    const normalizedSac = normalizedGst === null ? null : this.normalizeOptionalText(dto.sacCode);
    const data = {
      propertyName: dto.propertyName,
      locationType: dto.locationType,
      subTypes: subTypesNormalized,
      bio: dto.bio,
      aboutUs: dto.aboutUs,
      address: dto.address,
      addressLat: dto.addressLat,
      addressLng: dto.addressLng,
      locationCity: dto.locationCity,
      locationState: dto.locationState,
      website: dto.website,
      imdbUrl: dto.imdbUrl,
      instagramUrl: dto.instagramUrl,
      linkedinUrl: dto.linkedinUrl,
      twitterUrl: dto.twitterUrl,
      youtubeUrl: dto.youtubeUrl,
      vimeoUrl: dto.vimeoUrl,
      isAvailable: dto.isAvailable,
      panNumber: dto.panNumber,
      billingName: dto.billingName,
      gstNumber: normalizedGst,
      sacCode: normalizedSac,
      upiId: dto.upiId,
      bankAccountName: dto.bankAccountName,
      bankAccountNumber: dto.bankAccountNumber,
      ifscCode: dto.ifscCode,
      bankName: dto.bankName,
    };
    const filtered = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (existing) {
      return this.prisma.locationProfile.update({
        where: { userId },
        data: filtered,
      });
    }
    return this.prisma.locationProfile.create({
      data: {
        userId,
        propertyName: dto.propertyName ?? 'Unknown',
        locationType: dto.locationType ?? 'bungalow_villa_apartment',
        ...filtered,
      },
    });
  }

  // Resolve a location user's listed properties with signed photo/PDF URLs.
  // Used to embed `properties` on the profile (own + public). Mirrors how vendor
  // equipment is embedded, but properties carry multiple photos + a PDF.
  private async resolveLocationProperties(locationUserId: string) {
    const rows = await this.prisma.locationProperty.findMany({
      where: { locationUserId },
      include: { availabilities: { orderBy: { availableFrom: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return Promise.all(rows.map((row) => this.resolveLocationProperty(row)));
  }

  private async resolveLocationProperty(row: {
    id: string;
    name: string;
    description: string | null;
    subTypes: string[];
    city: string | null;
    address: string | null;
    addressLat: number | null;
    addressLng: number | null;
    dailyBudget: number | null;
    photoKeys: string[];
    pdfKey: string | null;
    pdfName: string | null;
    availabilities?: unknown[];
  }) {
    const photoUrls = (
      await Promise.all((row.photoKeys ?? []).map((k) => this.storage.resolveAvatarUrl(k)))
    ).filter((u): u is string => !!u);
    const pdfUrl = row.pdfKey
      ? (await this.storage.getSignedUrl(row.pdfKey)) ?? this.storage.getPublicUrl(row.pdfKey)
      : null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      subTypes: row.subTypes ?? [],
      city: row.city,
      address: row.address,
      addressLat: row.addressLat,
      addressLng: row.addressLng,
      dailyBudget: row.dailyBudget,
      photoUrls,
      pdfUrl,
      pdfName: row.pdfName,
      availabilities: row.availabilities ?? [],
    };
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
        castProfile: true,
        locationProfile: true,
        vendorEquipment: {
          include: {
            availabilities: {
              orderBy: { availableFrom: 'asc' },
            },
          },
        },
      },
    });
    if (!target) throw new NotFoundException('User not found');
    const profile = this.getProfileByRole(target);
    if (!profile) return { id: target.id, role: target.role, profile: null };

    const maskRates = viewerRole !== UserRole.company;
    const base = profile as Record<string, unknown>;
    let sanitized = { ...base };
    if (maskRates && 'dailyBudget' in base) {
      sanitized = { ...sanitized, dailyBudget: undefined };
    }
    const avatarUrl = base.avatarKey
      ? await this.storage.getSignedUrl(base.avatarKey as string) ?? this.storage.getPublicUrl(base.avatarKey as string)
      : null;
    const showreelUrl = base.showreelKey
      ? await this.storage.getSignedUrl(base.showreelKey as string) ?? this.storage.getPublicUrl(base.showreelKey as string)
      : null;
    const coverUrl = base.coverKey
      ? await this.storage.getSignedUrl(base.coverKey as string) ?? this.storage.getPublicUrl(base.coverKey as string)
      : null;
    const logoUrl = base.logoKey
      ? await this.storage.getSignedUrl(base.logoKey as string) ?? this.storage.getPublicUrl(base.logoKey as string)
      : null;
    const equipment = target.role === UserRole.vendor && (target as { vendorEquipment?: unknown[] }).vendorEquipment
      ? (target as { vendorEquipment: unknown[] }).vendorEquipment
      : undefined;
    const showcaseItems = target.role === UserRole.cast ? await this.resolveShowcaseItems(target.id) : undefined;
    // Location providers expose their listed properties + profile-level PDF to
    // viewers (the PDF is meant to be discoverable per the spec).
    let properties: unknown[] | undefined;
    let detailPdfUrl: string | null = null;
    if (target.role === UserRole.location) {
      properties = await this.resolveLocationProperties(target.id);
      const detailPdfKey = (base.detailPdfKey as string | null | undefined) ?? null;
      detailPdfUrl = detailPdfKey
        ? (await this.storage.getSignedUrl(detailPdfKey)) ?? this.storage.getPublicUrl(detailPdfKey)
        : null;
    }
    return {
      id: target.id,
      role: target.role,
      email: target.email,
      phone: target.phone,
      profile: { ...sanitized, avatarUrl, coverUrl, coverType: this.coverTypeFromKey(base.coverKey as string | null) ?? undefined, showreelUrl, logoUrl, ...(showcaseItems ? { showcaseItems } : {}), ...(equipment ? { equipment } : {}), ...(target.role === UserRole.location ? { properties: properties ?? [], detailPdfUrl: detailPdfUrl ?? undefined } : {}) },
    };
  }

  /**
   * Normalize an incoming MIME type to one we'll actually accept, plus the
   * file extension we'll write into the S3 key. Falls back to JPEG if the
   * client sent something we don't allow (so the upload still succeeds rather
   * than failing closed). Used for both avatar/logo and cover.
   */
  private resolveImageContentType(contentType?: string): { contentType: string; extension: string } {
    const normalized = (contentType ?? 'image/jpeg').toLowerCase();
    if (!ProfilesService.ALLOWED_IMAGE_CONTENT_TYPES.includes(normalized as typeof ProfilesService.ALLOWED_IMAGE_CONTENT_TYPES[number])) {
      return { contentType: 'image/jpeg', extension: 'jpg' };
    }
    if (normalized === 'image/png') return { contentType: normalized, extension: 'png' };
    if (normalized === 'image/webp') return { contentType: normalized, extension: 'webp' };
    return { contentType: normalized, extension: 'jpg' };
  }

  // A cover/banner can be an image OR a short motion banner (video). Video
  // MIMEs map here; anything else falls back to the image resolver.
  private static readonly COVER_VIDEO_TYPES: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };

  private resolveCoverContentType(contentType?: string): { contentType: string; extension: string; mediaType: 'image' | 'video' } {
    const normalized = (contentType ?? '').toLowerCase();
    const videoExt = ProfilesService.COVER_VIDEO_TYPES[normalized];
    if (videoExt) return { contentType: normalized, extension: videoExt, mediaType: 'video' };
    return { ...this.resolveImageContentType(contentType), mediaType: 'image' };
  }

  /** Infer how a stored cover should be rendered from its key extension. */
  private coverTypeFromKey(key?: string | null): 'image' | 'video' | null {
    if (!key) return null;
    const ext = key.split('.').pop()?.toLowerCase();
    return ext && ['mp4', 'mov', 'webm', 'm4v'].includes(ext) ? 'video' : 'image';
  }

  async getPresignedAvatarUrl(
    userId: string,
    contentType?: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    if (!this.storage.isConfigured() && !this.storage.isSupabaseConfigured()) {
      throw new Error('Storage is not configured. Set AWS_S3_BUCKET or SUPABASE_* env vars.');
    }
    // Critical: the contentType passed here MUST match what the client sends
    // on the PUT. AWS S3 includes Content-Type in the canonical request, so a
    // mismatch returns SignatureDoesNotMatch. Previous version hardcoded
    // image/jpeg here but the client sent file.type — every PNG upload failed.
    const resolved = this.resolveImageContentType(contentType);
    const key = `users/${userId}/avatar/${Date.now()}.${resolved.extension}`;
    return this.storage.getPresignedPutUrl(key, resolved.contentType);
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
    } else if (user.role === UserRole.cast) {
      await this.prisma.castProfile.upsert({
        where: { userId },
        create: { userId, displayName: 'Unknown', roleType: 'actor', avatarKey: key },
        update: { avatarKey: key },
      });
    } else if (user.role === UserRole.location) {
      await this.prisma.locationProfile.upsert({
        where: { userId },
        create: { userId, propertyName: 'Unknown', locationType: 'bungalow_villa_apartment', logoKey: key },
        update: { logoKey: key },
      });
    }
    return { key };
  }

  async getPresignedCoverUrl(
    userId: string,
    role: UserRole,
    contentType?: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    // All four profile roles support a cover/banner image. Sub-users
    // (whose role still equals their parent's role) are also fine here — the
    // controller's JwtAuthGuard already gates the endpoint on a valid session.
    if (
      role !== UserRole.individual &&
      role !== UserRole.vendor &&
      role !== UserRole.company &&
      role !== UserRole.cast &&
      role !== UserRole.location
    ) {
      throw new ForbiddenException('Cover photo is not available for this role');
    }
    if (!this.storage.isConfigured() && !this.storage.isSupabaseConfigured()) {
      throw new Error('Storage is not configured. Set AWS_S3_BUCKET or SUPABASE_* env vars.');
    }
    const resolved = this.resolveCoverContentType(contentType);
    const key = `users/${userId}/cover/${Date.now()}.${resolved.extension}`;
    return this.storage.getPresignedPutUrl(key, resolved.contentType);
  }

  async setCoverKey(userId: string, role: UserRole, key: string) {
    if (role === UserRole.individual) {
      await this.prisma.individualProfile.upsert({
        where: { userId },
        create: { userId, displayName: 'Unknown', coverKey: key },
        update: { coverKey: key },
      });
    } else if (role === UserRole.vendor) {
      await this.prisma.vendorProfile.upsert({
        where: { userId },
        create: { userId, companyName: 'Unknown', vendorType: VendorType.equipment, coverKey: key },
        update: { coverKey: key },
      });
    } else if (role === UserRole.company) {
      await this.prisma.companyProfile.upsert({
        where: { userId },
        create: { userId, companyName: 'Unknown', coverKey: key },
        update: { coverKey: key },
      });
    } else if (role === UserRole.cast) {
      await this.prisma.castProfile.upsert({
        where: { userId },
        create: { userId, displayName: 'Unknown', roleType: 'actor', coverKey: key },
        update: { coverKey: key },
      });
    } else if (role === UserRole.location) {
      await this.prisma.locationProfile.upsert({
        where: { userId },
        create: { userId, propertyName: 'Unknown', locationType: 'bungalow_villa_apartment', coverKey: key },
        update: { coverKey: key },
      });
    } else {
      throw new ForbiddenException('Cover photo is not available for this role');
    }
    return { key };
  }

  // ── Profile-level "detailed PDF" (location) ───────────────────────────────
  // A single detailed PDF of the location/property attached to the profile
  // (separate from per-property PDFs). Two-step: presign → confirm. PDF only.

  async getPresignedDetailPdfUrl(userId: string): Promise<{ uploadUrl: string; key: string }> {
    await this.ensureRole(userId, UserRole.location);
    if (!this.storage.isConfigured() && !this.storage.isSupabaseConfigured()) {
      throw new Error('Storage is not configured. Set AWS_S3_BUCKET or SUPABASE_* env vars.');
    }
    const key = `users/${userId}/location-pdf/${Date.now()}.pdf`;
    return this.storage.getPresignedPutUrl(key, 'application/pdf');
  }

  async setDetailPdfKey(userId: string, key: string, fileName?: string) {
    await this.ensureRole(userId, UserRole.location);
    // Defence-in-depth: never let a caller register a key outside their own namespace.
    const expectedPrefix = `users/${userId}/location-pdf/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new BadRequestException('Invalid storage key for this user.');
    }
    await this.prisma.locationProfile.upsert({
      where: { userId },
      create: { userId, propertyName: 'Unknown', locationType: 'bungalow_villa_apartment', detailPdfKey: key, detailPdfName: fileName?.trim() || null },
      update: { detailPdfKey: key, detailPdfName: fileName?.trim() || null },
    });
    return { key };
  }

  async getPresignedShowreelUrl(userId: string): Promise<{ uploadUrl: string; key: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true },
    });
    if (!user || (user.role !== UserRole.individual && user.role !== UserRole.cast)) {
      throw new ForbiddenException('Not allowed for your role');
    }
    if (!this.storage.isConfigured() && !this.storage.isSupabaseConfigured()) {
      throw new Error('Storage is not configured. Set AWS_S3_BUCKET or SUPABASE_* env vars.');
    }
    const key = `users/${userId}/showreel/${Date.now()}.mp4`;
    return this.storage.getPresignedPutUrl(key, 'video/mp4');
  }

  async setShowreelKey(userId: string, key: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.individual) {
      await this.prisma.individualProfile.upsert({
        where: { userId },
        create: { userId, displayName: 'Unknown', showreelKey: key },
        update: { showreelKey: key },
      });
    } else if (user.role === UserRole.cast) {
      await this.prisma.castProfile.upsert({
        where: { userId },
        create: { userId, displayName: 'Unknown', roleType: 'actor', showreelKey: key },
        update: { showreelKey: key },
      });
    } else {
      throw new ForbiddenException('Not allowed for your role');
    }
    return { key };
  }

  // ── Work Showcase (Cast) ──────────────────────────────────────────────
  // A gallery of images / videos / documents shown on the cast member's
  // profile (replaces the single-video showreel for cast). Backed by the
  // PortfolioItem table.

  async getShowcaseUploadUrl(userId: string, contentType: string) {
    await this.ensureRole(userId, UserRole.cast);
    if (!this.storage.isConfigured() && !this.storage.isSupabaseConfigured()) {
      throw new Error('Storage is not configured. Set AWS_S3_BUCKET or SUPABASE_* env vars.');
    }
    const normalized = (contentType ?? '').trim().toLowerCase();
    const mapped = ProfilesService.SHOWCASE_MIME_MAP[normalized];
    if (!mapped) {
      throw new BadRequestException('Unsupported file type. Upload an image, video, or document (no audio).');
    }
    // The contentType signed here MUST match the Content-Type the client sends
    // on the PUT, or S3 returns SignatureDoesNotMatch (same gotcha as avatar).
    const key = `users/${userId}/showcase/${Date.now()}.${mapped.extension}`;
    const presigned = await this.storage.getPresignedPutUrl(key, normalized);
    return { ...presigned, mediaType: mapped.mediaType };
  }

  async createShowcaseItem(userId: string, dto: CreateShowcaseItemDto) {
    await this.ensureRole(userId, UserRole.cast);
    // Don't let a caller register a key that isn't under their own namespace.
    const expectedPrefix = `users/${userId}/showcase/`;
    if (!dto.key.startsWith(expectedPrefix)) {
      throw new BadRequestException('Invalid storage key for this user.');
    }
    const last = await this.prisma.portfolioItem.findFirst({
      where: { userId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const item = await this.prisma.portfolioItem.create({
      data: {
        userId,
        title: dto.title?.trim() || dto.fileName?.trim() || 'Untitled',
        imageKey: dto.key,
        mediaType: dto.mediaType,
        fileName: dto.fileName?.trim() || null,
        mimeType: dto.mimeType?.trim() || null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    return this.resolveShowcaseItem(item);
  }

  async listShowcaseItems(userId: string) {
    await this.ensureRole(userId, UserRole.cast);
    return { items: await this.resolveShowcaseItems(userId) };
  }

  async deleteShowcaseItem(userId: string, itemId: string) {
    await this.ensureRole(userId, UserRole.cast);
    const item = await this.prisma.portfolioItem.findFirst({ where: { id: itemId, userId } });
    if (!item) throw new NotFoundException('Showcase item not found');
    await this.prisma.portfolioItem.delete({ where: { id: itemId } });
    // Best-effort storage cleanup — never block the delete on a storage error.
    try {
      await this.storage.deleteObject(item.imageKey);
    } catch {
      /* ignore — orphaned object will TTL out of any signed-URL cache */
    }
    return { message: 'Item removed' };
  }

  private async resolveShowcaseItems(userId: string) {
    const items = await this.prisma.portfolioItem.findMany({
      where: { userId },
      orderBy: { sortOrder: 'asc' },
    });
    return Promise.all(items.map((i) => this.resolveShowcaseItem(i)));
  }

  private async resolveShowcaseItem(item: {
    id: string;
    title: string;
    imageKey: string;
    mediaType: string;
    fileName: string | null;
    mimeType: string | null;
    sortOrder: number;
    createdAt: Date;
  }) {
    const url = (await this.storage.getSignedUrl(item.imageKey)) ?? this.storage.getPublicUrl(item.imageKey);
    return {
      id: item.id,
      title: item.title,
      mediaType: item.mediaType,
      fileName: item.fileName,
      mimeType: item.mimeType,
      sortOrder: item.sortOrder,
      url,
      createdAt: item.createdAt,
    };
  }

  async listSubUsers(userId: string, role: UserRole) {
    if (role !== UserRole.company && role !== UserRole.vendor) {
      throw new ForbiddenException('Only company/vendor accounts support sub-users');
    }
    const me = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, mainUserId: true },
    });
    if (!me || me.mainUserId) {
      throw new ForbiddenException('Only Main ID can list sub-users');
    }
    const items = await this.prisma.user.findMany({
      where: {
        mainUserId: me.id,
        role: me.role,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        displayName: true,
        isActive: true,
        createdAt: true,
        subUserProjectAssignments: {
          select: {
            project: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: items.map(({ subUserProjectAssignments, ...rest }) => ({
        ...rest,
        assignedProjects: subUserProjectAssignments.map((a) => a.project),
      })),
    };
  }

  async createSubUser(userId: string, role: UserRole, dto: CreateSubUserDto) {
    if (role !== UserRole.company && role !== UserRole.vendor) {
      throw new ForbiddenException('Only company/vendor accounts support sub-users');
    }
    const me = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, mainUserId: true },
    });
    if (!me || me.mainUserId) {
      throw new ForbiddenException('Only Main ID can create sub-users');
    }
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { phone: dto.phone }],
        deletedAt: null,
      },
      select: { id: true, email: true, phone: true },
    });
    if (existing) {
      if (existing.email === dto.email) throw new ConflictException('Email already registered');
      throw new ConflictException('Phone already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, ProfilesService.SUB_USER_PASSWORD_ROUNDS);
    const sub = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        displayName: dto.displayName?.trim() || null,
        passwordHash,
        role: me.role,
        mainUserId: me.id,
        isVerified: true,
      },
      select: { id: true, email: true, phone: true, displayName: true, role: true, mainUserId: true, isActive: true, createdAt: true },
    });
    return sub;
  }

  async assignProjectToSubUser(userId: string, role: UserRole, subUserId: string, projectId: string) {
    if (role !== UserRole.company && role !== UserRole.vendor) {
      throw new ForbiddenException('Only company/vendor accounts support sub-users');
    }
    const me = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, mainUserId: true },
    });
    if (!me || me.mainUserId) {
      throw new ForbiddenException('Only Main ID can assign projects');
    }
    const subUser = await this.prisma.user.findFirst({
      where: {
        id: subUserId,
        role: me.role,
        mainUserId: me.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!subUser) throw new NotFoundException('Sub-user not found');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, companyUserId: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (me.role === UserRole.company) {
      if (project.companyUserId !== me.id) throw new ForbiddenException('Project is not owned by your company account');
    } else {
      const bookingExists = await this.prisma.bookingRequest.findFirst({
        where: {
          projectId,
          targetUserId: me.id,
          status: { in: ['pending', 'accepted', 'locked'] },
        },
        select: { id: true },
      });
      if (!bookingExists) {
        throw new BadRequestException('Vendor account can assign only projects where it has a request/booking');
      }
    }

    return this.prisma.subUserProjectAssignment.upsert({
      where: { subUserId_projectId: { subUserId, projectId } },
      create: {
        accountUserId: me.id,
        subUserId,
        projectId,
      },
      update: {},
      include: {
        project: { select: { id: true, title: true } },
        subUser: { select: { id: true, email: true, displayName: true } },
      },
    });
  }

  async deleteSubUser(userId: string, role: UserRole, subUserId: string) {
    if (role !== UserRole.company && role !== UserRole.vendor) {
      throw new ForbiddenException('Only company/vendor accounts support sub-users');
    }
    const me = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, mainUserId: true },
    });
    if (!me || me.mainUserId) {
      throw new ForbiddenException('Only Main ID can delete sub-users');
    }
    const subUser = await this.prisma.user.findFirst({
      where: {
        id: subUserId,
        role: me.role,
        mainUserId: me.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!subUser) throw new NotFoundException('Sub-user not found');
    await this.prisma.user.update({
      where: { id: subUserId },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Sub-user removed' };
  }
}
