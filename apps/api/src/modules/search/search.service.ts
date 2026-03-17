import { Injectable, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { SearchCrewQueryDto, SearchVendorsQueryDto } from './dto/search-query.dto';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async searchCrew(viewerId: string, viewerRole: UserRole, query: SearchCrewQueryDto) {
    if (viewerRole !== 'company') {
      throw new ForbiddenException('Only companies can search crew');
    }
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const skip = (page - 1) * limit;

    const skillsFilter = query.skill
      ? query.skill.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : null;

    const startDate = query.startDate ? new Date(query.startDate) : null;
    const endDate = query.endDate ? new Date(query.endDate) : null;

    const where: any = {
      user: { deletedAt: null, isActive: true },
      AND: [] as any[],
    };
    if (query.city) {
      where.AND.push({ locationCity: { equals: query.city, mode: 'insensitive' } });
    }
    if (query.state) {
      where.AND.push({ locationState: { equals: query.state, mode: 'insensitive' } });
    }
    if (skillsFilter?.length) {
      where.AND.push({ skills: { hasSome: skillsFilter } });
    }
    if (query.rateMin != null || query.rateMax != null) {
      if (query.rateMin != null) {
        where.AND.push({ OR: [{ dailyRateMax: { gte: query.rateMin } }, { dailyRateMax: null }] });
      }
      if (query.rateMax != null) {
        where.AND.push({ OR: [{ dailyRateMin: { lte: query.rateMax } }, { dailyRateMin: null }] });
      }
    }
    if (query.availableOnly === true) {
      where.AND.push({ isAvailable: true });
    }
    if (query.name?.trim()) {
      const name = query.name.trim();
      where.AND.push({
        OR: [
          { displayName: { contains: name, mode: 'insensitive' } },
          { user: { email: { contains: name, mode: 'insensitive' } } },
        ],
      });
    }

    const takeSize = startDate && endDate ? limit * 3 : limit + 1;
    const profiles = await this.prisma.individualProfile.findMany({
      where,
      include: {
        user: { select: { id: true, email: true } },
      },
      orderBy: { profileScore: 'desc' },
      skip,
      take: takeSize,
    });

    let filtered = profiles;
    if (startDate && endDate) {
      const userIdsWithBooked = await this.prisma.availabilitySlot.findMany({
        where: {
          date: { gte: startDate, lte: endDate },
          status: 'booked',
        },
        select: { userId: true },
        distinct: ['userId'],
      });
      const bookedSet = new Set(userIdsWithBooked.map((s) => s.userId));
      filtered = profiles.filter((p) => !bookedSet.has(p.userId));
    }

    const items = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const total = await this.prisma.individualProfile.count({ where });

    return {
      items: items.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        bio: p.bio,
        skills: p.skills,
        locationCity: p.locationCity,
        locationState: p.locationState,
        dailyRateMin: p.dailyRateMin,
        dailyRateMax: p.dailyRateMax,
        profileScore: p.profileScore,
        isAvailable: p.isAvailable,
        email: p.user.email,
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit), hasMore },
    };
  }

  async searchVendors(viewerId: string, viewerRole: UserRole, query: SearchVendorsQueryDto) {
    if (viewerRole !== 'company') {
      throw new ForbiddenException('Only companies can search vendors');
    }
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const skip = (page - 1) * limit;
    const requestedStart = query.startDate ? new Date(query.startDate) : null;
    const requestedEnd = query.endDate ? new Date(query.endDate) : null;
    const requestedCity = query.city?.trim().toLowerCase();
    const equipmentName = query.equipmentName?.trim().toLowerCase();
    const hasEquipmentAvailabilityFilter = !!(requestedCity || requestedStart || requestedEnd || equipmentName);

    // Equipment IDs that are already booked (accepted/locked) for shoots overlapping the requested date range
    let bookedEquipmentIds = new Set<string>();
    if (requestedStart && requestedEnd) {
      const bookings = await this.prisma.bookingRequest.findMany({
        where: {
          vendorEquipmentId: { not: null },
          status: { in: ['accepted', 'locked'] },
          project: {
            startDate: { lte: requestedEnd },
            endDate: { gte: requestedStart },
          },
        },
        select: { vendorEquipmentId: true },
      });
      bookings.forEach((b) => {
        if (b.vendorEquipmentId) bookedEquipmentIds.add(b.vendorEquipmentId);
      });
    }

    const where: Record<string, unknown> = {
      user: { deletedAt: null, isActive: true },
    };
    if (query.type) {
      (where as any).OR = [
        { vendorType: query.type },
        { vendorType: 'all' },
      ];
    }

    const rawItems = await this.prisma.vendorProfile.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            vendorEquipment: {
              include: {
                availabilities: {
                  orderBy: { availableFrom: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { companyName: 'asc' },
    });

    const filteredItems = rawItems
      .map((p) => {
        const allEquipment = p.user.vendorEquipment ?? [];
        const matchedEquipment = allEquipment.filter((eq) => {
          if (equipmentName && !eq.name.toLowerCase().includes(equipmentName)) return false;
          // Exclude equipment that is already booked for another shoot in the requested date range
          if (bookedEquipmentIds.has(eq.id)) return false;

          // If no city or date filters, any matching equipment name is fine.
          if (!requestedCity && !requestedStart && !requestedEnd) return true;

          const availabilities = eq.availabilities ?? [];

          // If vendor has defined availability slots, use them for city/date filtering.
          if (availabilities.length > 0) {
            return availabilities.some((slot) => {
              const slotCity = slot.locationCity.trim().toLowerCase();
              if (requestedCity && slotCity !== requestedCity) return false;
              if (requestedStart && requestedEnd) {
                return slot.availableFrom <= requestedEnd && slot.availableTo >= requestedStart;
              }
              if (requestedStart) {
                return slot.availableFrom <= requestedStart && slot.availableTo >= requestedStart;
              }
              if (requestedEnd) {
                return slot.availableFrom <= requestedEnd && slot.availableTo >= requestedEnd;
              }
              return true;
            });
          }

          // No explicit availability rows yet: fall back to equipment.currentCity
          if (requestedCity) {
            const eqCity = eq.currentCity?.trim().toLowerCase();
            return eqCity === requestedCity;
          }

          // Date-only filter without city and no availabilities ⇒ treat as not match
          return false;
        });
        // Display only the equipment's location (set by vendor on equipment/availability), never vendor profile location
        const firstEq = matchedEquipment[0];
        const firstAvail = firstEq?.availabilities?.[0];
        const locationCity =
          firstEq?.currentCity?.trim() ||
          firstAvail?.locationCity?.trim() ||
          null;

        return {
          userId: p.userId,
          companyName: p.companyName,
          vendorType: p.vendorType,
          isGstVerified: p.isGstVerified,
          email: p.user.email,
          locationCity,
          equipment: matchedEquipment,
          _equipmentCount: matchedEquipment.length,
        } as const;
      })
      .filter((item) => !hasEquipmentAvailabilityFilter || item._equipmentCount > 0);
    const total = filteredItems.length;
    const items = filteredItems.slice(skip, skip + limit);

    return {
      items: items.map(({ _equipmentCount, ...rest }) => rest),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }
}
