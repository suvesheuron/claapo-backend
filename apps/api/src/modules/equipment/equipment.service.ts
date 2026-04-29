import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { CreateEquipmentAvailabilityDto } from './dto/create-equipment-availability.dto';
import { UpdateEquipmentAvailabilityDto } from './dto/update-equipment-availability.dto';

@Injectable()
export class EquipmentService {
  /** Match search service: kit still "at" shoot city for a few days after wrap. */
  private readonly locationReturnBufferDays = 5;

  constructor(private readonly prisma: PrismaService) {}

  async listMyEquipment(vendorUserId: string) {
    await this.ensureVendor(vendorUserId);
    const rows = await this.prisma.vendorEquipment.findMany({
      where: { vendorUserId },
      include: {
        availabilities: {
          orderBy: { availableFrom: 'asc' },
        },
        bookingRequests: {
          where: { status: { in: ['accepted', 'locked'] } },
          select: {
            id: true,
            project: {
              select: {
                title: true,
                startDate: true,
                endDate: true,
                locationCity: true,
                shootLocations: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const now = Date.now();
    return rows.map((eq) => {
      let effectiveLocation: string | null = null;
      let effectiveLocationUntil: string | null = null;
      const bookings = [...(eq.bookingRequests ?? [])].sort(
        (a, b) =>
          new Date(b.project.startDate).getTime() - new Date(a.project.startDate).getTime(),
      );
      for (const br of bookings) {
        const p = br.project;
        const start = new Date(p.startDate).getTime();
        const endBufDate = new Date(p.endDate);
        endBufDate.setUTCDate(endBufDate.getUTCDate() + this.locationReturnBufferDays);
        const endBuf = endBufDate.getTime();
        if (now >= start && now <= endBuf) {
          effectiveLocation =
            p.locationCity?.trim() || (p.shootLocations?.[0]?.trim() ?? null) || null;
          effectiveLocationUntil = endBufDate.toISOString();
          break;
        }
      }
      return { ...eq, effectiveLocation, effectiveLocationUntil };
    });
  }

  async getEquipmentForVendor(vendorUserId: string) {
    return this.prisma.vendorEquipment.findMany({
      where: { vendorUserId },
      include: {
        availabilities: {
          orderBy: { availableFrom: 'asc' },
        },
        bookingRequests: {
          where: {
            status: { in: ['accepted', 'locked', 'cancel_requested'] },
          },
          select: {
            id: true,
            status: true,
            shootDates: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(vendorUserId: string, dto: CreateEquipmentDto) {
    await this.ensureVendor(vendorUserId);
    return this.prisma.vendorEquipment.create({
      data: {
        vendorUserId,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? null,
        imageUrl: dto.imageUrl?.trim() ?? null,
        currentCity: dto.currentCity?.trim() ?? null,
        dailyBudget: dto.dailyBudget ?? null,
        quantityTotal: dto.quantityTotal ?? 1,
      },
    });
  }

  async update(vendorUserId: string, equipmentId: string, dto: UpdateEquipmentDto) {
    await this.ensureVendor(vendorUserId);
    const existing = await this.prisma.vendorEquipment.findFirst({
      where: { id: equipmentId, vendorUserId },
    });
    if (!existing) throw new NotFoundException('Equipment not found');
    const data: {
      name?: string;
      description?: string | null;
      imageUrl?: string | null;
      currentCity?: string | null;
      dailyBudget?: number | null;
      quantityTotal?: number;
    } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() ?? null;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl?.trim() ?? null;
    if (dto.currentCity !== undefined) data.currentCity = dto.currentCity?.trim() ?? null;
    if (dto.dailyBudget !== undefined) data.dailyBudget = dto.dailyBudget;
    if (dto.quantityTotal !== undefined) data.quantityTotal = dto.quantityTotal;
    return this.prisma.vendorEquipment.update({
      where: { id: equipmentId },
      data,
    });
  }

  async delete(vendorUserId: string, equipmentId: string) {
    await this.ensureVendor(vendorUserId);
    const existing = await this.prisma.vendorEquipment.findFirst({
      where: { id: equipmentId, vendorUserId },
    });
    if (!existing) throw new NotFoundException('Equipment not found');
    return this.prisma.vendorEquipment.delete({ where: { id: equipmentId } });
  }

  async addAvailability(vendorUserId: string, equipmentId: string, dto: CreateEquipmentAvailabilityDto) {
    await this.ensureVendor(vendorUserId);
    const equipment = await this.prisma.vendorEquipment.findFirst({
      where: { id: equipmentId, vendorUserId },
    });
    if (!equipment) throw new NotFoundException('Equipment not found');
    const from = new Date(dto.availableFrom);
    const to = new Date(dto.availableTo);
    if (from > to) throw new BadRequestException('availableFrom must be before availableTo');
    return this.prisma.vendorEquipmentAvailability.create({
      data: {
        equipmentId,
        locationCity: dto.locationCity.trim(),
        availableFrom: from,
        availableTo: to,
        notes: dto.notes?.trim() ?? null,
      },
    });
  }

  async updateAvailability(
    vendorUserId: string,
    equipmentId: string,
    availabilityId: string,
    dto: UpdateEquipmentAvailabilityDto,
  ) {
    await this.ensureVendor(vendorUserId);
    const equipment = await this.prisma.vendorEquipment.findFirst({
      where: { id: equipmentId, vendorUserId },
    });
    if (!equipment) throw new NotFoundException('Equipment not found');
    const existing = await this.prisma.vendorEquipmentAvailability.findFirst({
      where: { id: availabilityId, equipmentId },
    });
    if (!existing) throw new NotFoundException('Availability not found');
    const nextFrom = dto.availableFrom ? new Date(dto.availableFrom) : existing.availableFrom;
    const nextTo = dto.availableTo ? new Date(dto.availableTo) : existing.availableTo;
    if (nextFrom > nextTo) throw new BadRequestException('availableFrom must be before availableTo');
    return this.prisma.vendorEquipmentAvailability.update({
      where: { id: availabilityId },
      data: {
        locationCity: dto.locationCity !== undefined ? dto.locationCity.trim() : undefined,
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : undefined,
        availableTo: dto.availableTo ? new Date(dto.availableTo) : undefined,
        notes: dto.notes !== undefined ? dto.notes?.trim() ?? null : undefined,
      },
    });
  }

  async deleteAvailability(vendorUserId: string, equipmentId: string, availabilityId: string) {
    await this.ensureVendor(vendorUserId);
    const equipment = await this.prisma.vendorEquipment.findFirst({
      where: { id: equipmentId, vendorUserId },
    });
    if (!equipment) throw new NotFoundException('Equipment not found');
    const existing = await this.prisma.vendorEquipmentAvailability.findFirst({
      where: { id: availabilityId, equipmentId },
    });
    if (!existing) throw new NotFoundException('Availability not found');
    return this.prisma.vendorEquipmentAvailability.delete({ where: { id: availabilityId } });
  }

  private async ensureVendor(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user || user.role !== UserRole.vendor) {
      throw new ForbiddenException('Only vendors can manage equipment');
    }
  }
}
