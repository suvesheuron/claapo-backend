import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { CreatePropertyAvailabilityDto } from './dto/create-property-availability.dto';
import { UpdatePropertyAvailabilityDto } from './dto/update-property-availability.dto';
import { PropertyUploadKind } from './dto/property-upload-url.dto';

/**
 * Property/Setup listings for `location` users — the location analogue of the
 * vendor Equipment system (catalog item + date-range availability + booking
 * link). Each property carries multiple photos and an optional PDF, stored as
 * object keys and resolved to signed URLs on read.
 */
@Injectable()
export class PropertiesService {
  // Photos accept the same image set as avatars/covers; PDF is the only doc type.
  private static readonly PHOTO_MIME_MAP: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async listMine(locationUserId: string) {
    await this.ensureLocation(locationUserId);
    return this.listForOwner(locationUserId);
  }

  /**
   * Company-facing list of a location's properties — used by the booking modal
   * so a company can pick which property/setup to request. Mirrors
   * EquipmentService.getEquipmentForVendor. No ownership check (read-only,
   * gated to company/admin/location at the controller).
   */
  async getPropertiesForLocation(locationUserId: string) {
    const rows = await this.prisma.locationProperty.findMany({
      where: { locationUserId },
      include: {
        availabilities: { orderBy: { availableFrom: 'asc' } },
        bookingRequests: {
          where: { status: { in: ['accepted', 'locked', 'cancel_requested'] } },
          select: { id: true, status: true, shootDates: true },
        },
      },
      orderBy: { name: 'asc' },
    });
    return Promise.all(rows.map((row) => this.resolveProperty(row)));
  }

  /** Owner view — full detail incl. accepted/locked bookings for conflict UI. */
  private async listForOwner(locationUserId: string) {
    const rows = await this.prisma.locationProperty.findMany({
      where: { locationUserId },
      include: {
        availabilities: { orderBy: { availableFrom: 'asc' } },
        bookingRequests: {
          where: { status: { in: ['accepted', 'locked', 'cancel_requested'] } },
          select: { id: true, status: true, shootDates: true },
        },
      },
      orderBy: { name: 'asc' },
    });
    return Promise.all(rows.map((row) => this.resolveProperty(row)));
  }

  async create(locationUserId: string, dto: CreatePropertyDto) {
    await this.ensureLocation(locationUserId);
    const photoKeys = this.assertOwnedKeys(locationUserId, dto.photoKeys ?? []);
    const pdfKey = dto.pdfKey ? this.assertOwnedKey(locationUserId, dto.pdfKey) : null;
    const row = await this.prisma.locationProperty.create({
      data: {
        locationUserId,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? null,
        subTypes: dto.subTypes?.map((s) => s.trim()).filter(Boolean) ?? [],
        city: dto.city?.trim() ?? null,
        address: dto.address?.trim() ?? null,
        addressLat: dto.addressLat ?? null,
        addressLng: dto.addressLng ?? null,
        dailyBudget: dto.dailyBudget ?? null,
        photoKeys,
        pdfKey,
        pdfName: dto.pdfName?.trim() ?? null,
      },
      include: { availabilities: true },
    });
    return this.resolveProperty(row);
  }

  async update(locationUserId: string, propertyId: string, dto: UpdatePropertyDto) {
    await this.ensureLocation(locationUserId);
    const existing = await this.prisma.locationProperty.findFirst({
      where: { id: propertyId, locationUserId },
    });
    if (!existing) throw new NotFoundException('Property not found');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() ?? null;
    if (dto.subTypes !== undefined) data.subTypes = dto.subTypes.map((s) => s.trim()).filter(Boolean);
    if (dto.city !== undefined) data.city = dto.city?.trim() ?? null;
    if (dto.address !== undefined) data.address = dto.address?.trim() ?? null;
    if (dto.addressLat !== undefined) data.addressLat = dto.addressLat;
    if (dto.addressLng !== undefined) data.addressLng = dto.addressLng;
    if (dto.dailyBudget !== undefined) data.dailyBudget = dto.dailyBudget;
    if (dto.photoKeys !== undefined) data.photoKeys = this.assertOwnedKeys(locationUserId, dto.photoKeys);
    if (dto.pdfKey !== undefined) data.pdfKey = dto.pdfKey ? this.assertOwnedKey(locationUserId, dto.pdfKey) : null;
    if (dto.pdfName !== undefined) data.pdfName = dto.pdfName?.trim() ?? null;
    const row = await this.prisma.locationProperty.update({
      where: { id: propertyId },
      data,
      include: { availabilities: { orderBy: { availableFrom: 'asc' } } },
    });
    return this.resolveProperty(row);
  }

  async delete(locationUserId: string, propertyId: string) {
    await this.ensureLocation(locationUserId);
    const existing = await this.prisma.locationProperty.findFirst({
      where: { id: propertyId, locationUserId },
    });
    if (!existing) throw new NotFoundException('Property not found');
    await this.prisma.locationProperty.delete({ where: { id: propertyId } });
    // Best-effort storage cleanup; never block the delete on a storage error.
    for (const key of [...(existing.photoKeys ?? []), existing.pdfKey].filter(Boolean) as string[]) {
      try {
        await this.storage.deleteObject(key);
      } catch {
        /* ignore — orphaned object TTLs out of any signed-URL cache */
      }
    }
    return { message: 'Property removed' };
  }

  async addAvailability(locationUserId: string, propertyId: string, dto: CreatePropertyAvailabilityDto) {
    await this.ensureOwnedProperty(locationUserId, propertyId);
    const from = new Date(dto.availableFrom);
    const to = new Date(dto.availableTo);
    if (from > to) throw new BadRequestException('availableFrom must be before availableTo');
    return this.prisma.locationPropertyAvailability.create({
      data: {
        propertyId,
        locationCity: dto.locationCity.trim(),
        availableFrom: from,
        availableTo: to,
        notes: dto.notes?.trim() ?? null,
      },
    });
  }

  async updateAvailability(
    locationUserId: string,
    propertyId: string,
    availabilityId: string,
    dto: UpdatePropertyAvailabilityDto,
  ) {
    await this.ensureOwnedProperty(locationUserId, propertyId);
    const existing = await this.prisma.locationPropertyAvailability.findFirst({
      where: { id: availabilityId, propertyId },
    });
    if (!existing) throw new NotFoundException('Availability not found');
    const nextFrom = dto.availableFrom ? new Date(dto.availableFrom) : existing.availableFrom;
    const nextTo = dto.availableTo ? new Date(dto.availableTo) : existing.availableTo;
    if (nextFrom > nextTo) throw new BadRequestException('availableFrom must be before availableTo');
    return this.prisma.locationPropertyAvailability.update({
      where: { id: availabilityId },
      data: {
        locationCity: dto.locationCity !== undefined ? dto.locationCity.trim() : undefined,
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : undefined,
        availableTo: dto.availableTo ? new Date(dto.availableTo) : undefined,
        notes: dto.notes !== undefined ? dto.notes?.trim() ?? null : undefined,
      },
    });
  }

  async deleteAvailability(locationUserId: string, propertyId: string, availabilityId: string) {
    await this.ensureOwnedProperty(locationUserId, propertyId);
    const existing = await this.prisma.locationPropertyAvailability.findFirst({
      where: { id: availabilityId, propertyId },
    });
    if (!existing) throw new NotFoundException('Availability not found');
    return this.prisma.locationPropertyAvailability.delete({ where: { id: availabilityId } });
  }

  /** Two-step upload: presign a PUT for a property photo or PDF. */
  async getUploadUrl(locationUserId: string, kind: PropertyUploadKind, contentType?: string) {
    await this.ensureLocation(locationUserId);
    if (!this.storage.isConfigured() && !this.storage.isSupabaseConfigured()) {
      throw new Error('Storage is not configured. Set AWS_S3_BUCKET or SUPABASE_* env vars.');
    }
    const normalized = (contentType ?? '').trim().toLowerCase();
    if (kind === 'pdf') {
      if (normalized && normalized !== 'application/pdf') {
        throw new BadRequestException('Only PDF files are allowed here.');
      }
      const key = `users/${locationUserId}/property/${Date.now()}.pdf`;
      return this.storage.getPresignedPutUrl(key, 'application/pdf');
    }
    const ext = PropertiesService.PHOTO_MIME_MAP[normalized];
    if (!ext) throw new BadRequestException('Unsupported image type. Use JPEG, PNG, or WebP.');
    const key = `users/${locationUserId}/property/${Date.now()}.${ext}`;
    return this.storage.getPresignedPutUrl(key, normalized);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async ensureLocation(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user || user.role !== UserRole.location) {
      throw new ForbiddenException('Only location providers can manage properties');
    }
  }

  private async ensureOwnedProperty(locationUserId: string, propertyId: string) {
    await this.ensureLocation(locationUserId);
    const property = await this.prisma.locationProperty.findFirst({
      where: { id: propertyId, locationUserId },
    });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  /** Reject any storage key that isn't under the caller's own namespace. */
  private assertOwnedKey(userId: string, key: string): string {
    const prefix = `users/${userId}/property/`;
    if (!key.startsWith(prefix)) {
      throw new BadRequestException('Invalid storage key for this user.');
    }
    return key;
  }

  private assertOwnedKeys(userId: string, keys: string[]): string[] {
    return keys.map((k) => this.assertOwnedKey(userId, k));
  }

  private async resolveProperty(row: {
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
    bookingRequests?: unknown[];
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
      // Raw keys are returned to the OWNER (this resolver only feeds
      // /properties/me) so the management UI can preserve/append photos on
      // edit. The public profile embed uses a separate resolver that omits keys.
      photoKeys: row.photoKeys ?? [],
      photoUrls,
      pdfKey: row.pdfKey,
      pdfUrl,
      pdfName: row.pdfName,
      availabilities: row.availabilities ?? [],
      ...(row.bookingRequests ? { bookingRequests: row.bookingRequests } : {}),
    };
  }
}
