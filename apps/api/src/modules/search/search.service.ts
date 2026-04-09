import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { SearchCrewQueryDto, SearchVendorsQueryDto } from './dto/search-query.dto';

@Injectable()
export class SearchService {
  /** Days after project wrap when gear is still treated at shoot location (travel / prep). */
  private readonly LOCATION_RETURN_BUFFER_DAYS = 5;

  constructor(private readonly prisma: PrismaService) {}

  private projectLocationMatchesCity(
    project: { locationCity: string | null; shootLocations: string[] },
    requestedCityNorm: string,
  ): boolean {
    if (!requestedCityNorm) return false;
    const lc = project.locationCity?.trim().toLowerCase() ?? '';
    if (lc && (lc.includes(requestedCityNorm) || requestedCityNorm.includes(lc))) return true;
    for (const loc of project.shootLocations ?? []) {
      const l = loc.trim().toLowerCase();
      if (l && (l.includes(requestedCityNorm) || requestedCityNorm.includes(l))) return true;
    }
    return false;
  }

  async searchCrew(viewerId: string, viewerRole: UserRole, query: SearchCrewQueryDto) {
    if (viewerRole !== 'company') {
      throw new ForbiddenException('Only companies can search crew');
    }
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const skip = (page - 1) * limit;
    //  keeping it lowercase for case insensitivity
    const skillsFilter = query.skill
      ? query.skill.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : null;

    const startDate = query.startDate ? new Date(query.startDate) : null;
    const endDate = query.endDate ? new Date(query.endDate) : null;
    const rateMin = query.rateMin ?? null;
    const rateMax = query.rateMax ?? null;

    if (rateMin != null && rateMax != null && rateMin > rateMax) {
      throw new BadRequestException('rateMin cannot be greater than rateMax');
    }

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
    if (rateMin != null) {
      where.AND.push({ dailyBudget: { gte: rateMin } });
    }
    if (rateMax != null) {
      where.AND.push({ dailyBudget: { lte: rateMax } });
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

    const hasSkillFilter = !!skillsFilter?.length;
    const takeSize = startDate && endDate ? limit * 3 : limit + 1;
    const profiles = await this.prisma.individualProfile.findMany({
      where,
      select: {
        userId: true,
        displayName: true,
        bio: true,
        skills: true,
        locationCity: true,
        locationState: true,
        dailyBudget: true,
        profileScore: true,
        isAvailable: true,
      },
      orderBy: { profileScore: 'desc' },
      ...(hasSkillFilter ? {} : { skip, take: takeSize }),
    });

    let filtered = profiles;
    if (hasSkillFilter && skillsFilter?.length) {
      filtered = filtered.filter((p) => {
        const profileSkills = (p.skills ?? []).map((s) => s.trim().toLowerCase());
        return skillsFilter.some((skill) => profileSkills.includes(skill));
      });
    }
    if (startDate && endDate) {
      const userIdsUnavailable = await this.prisma.availabilitySlot.findMany({
        where: {
          date: { gte: startDate, lte: endDate },
          status: { in: ['booked', 'blocked'] },
        },
        select: { userId: true },
        distinct: ['userId'],
      });
      const unavailableSet = new Set(userIdsUnavailable.map((s) => s.userId));
      filtered = filtered.filter((p) => !unavailableSet.has(p.userId));
    }

    const paged = hasSkillFilter ? filtered.slice(skip, skip + limit + 1) : filtered;
    const items = paged.slice(0, limit);
    const hasMore = paged.length > limit;
    const total = hasSkillFilter
      ? filtered.length
      : await this.prisma.individualProfile.count({ where });
    const userIds = items.map((i) => i.userId);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true },
        })
      : [];
    const emailByUserId = new Map(users.map((u) => [u.id, u.email]));

    return {
      items: items.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        bio: p.bio,
        skills: p.skills,
        locationCity: p.locationCity,
        locationState: p.locationState,
        dailyBudget: p.dailyBudget,
        profileScore: p.profileScore,
        isAvailable: p.isAvailable,
        email: emailByUserId.get(p.userId) ?? '',
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
    const companyName = query.companyName?.trim();
    const rateMin = query.rateMin ?? null;
    const rateMax = query.rateMax ?? null;
    const hasEquipmentAvailabilityFilter = !!(
      requestedCity ||
      requestedStart ||
      requestedEnd ||
      equipmentName ||
      rateMin != null ||
      rateMax != null
    );

    if (rateMin != null && rateMax != null && rateMin > rateMax) {
      throw new BadRequestException('rateMin cannot be greater than rateMax');
    }

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
    if (companyName) {
      (where as any).companyName = { contains: companyName, mode: 'insensitive' };
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

    const allEquipmentIds = rawItems.flatMap((p) => (p.user.vendorEquipment ?? []).map((eq) => eq.id));

    /** Kit is on a job site (or return window) matching `requestedCity` — still discoverable for that region. */
    const locationBoostByEquip = new Map<string, string>();
    if (requestedCity && requestedStart && requestedEnd && allEquipmentIds.length > 0) {
      const assignmentRows = await this.prisma.bookingRequest.findMany({
        where: {
          vendorEquipmentId: { in: allEquipmentIds },
          status: { in: ['accepted', 'locked'] },
        },
        select: {
          vendorEquipmentId: true,
          project: {
            select: {
              locationCity: true,
              shootLocations: true,
              startDate: true,
              endDate: true,
            },
          },
        },
      });
      for (const row of assignmentRows) {
        const eqId = row.vendorEquipmentId;
        if (!eqId || bookedEquipmentIds.has(eqId)) continue;
        const proj = row.project;
        if (!this.projectLocationMatchesCity(proj, requestedCity)) continue;
        const pStart = new Date(proj.startDate);
        const pEndBuf = new Date(proj.endDate);
        pEndBuf.setUTCDate(pEndBuf.getUTCDate() + this.LOCATION_RETURN_BUFFER_DAYS);
        if (pStart <= requestedEnd && pEndBuf >= requestedStart) {
          const label =
            proj.locationCity?.trim() || proj.shootLocations?.[0]?.trim() || requestedCity;
          if (!locationBoostByEquip.has(eqId)) locationBoostByEquip.set(eqId, label);
        }
      }
    }

    const filteredItems = rawItems
      .map((p) => {
        const allEquipment = p.user.vendorEquipment ?? [];
        const matchedEquipment = allEquipment.filter((eq) => {
          if (equipmentName && !eq.name.toLowerCase().includes(equipmentName)) return false;
          if (rateMin != null && (eq.dailyBudget == null || eq.dailyBudget < rateMin)) return false;
          if (rateMax != null && (eq.dailyBudget == null || eq.dailyBudget > rateMax)) return false;
          // Exclude equipment that is already booked for another shoot in the requested date range
          if (bookedEquipmentIds.has(eq.id)) return false;

          // If no city or date filters, any matching equipment name is fine.
          if (!requestedCity && !requestedStart && !requestedEnd) return true;

          const availabilities = eq.availabilities ?? [];

          const matchesAvailabilitySlot = (): boolean =>
            availabilities.some((slot) => {
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

          if (availabilities.length > 0 && matchesAvailabilitySlot()) return true;

          if (requestedCity) {
            const eqCity = eq.currentCity?.trim().toLowerCase();
            if (eqCity === requestedCity) return true;
            if (locationBoostByEquip.has(eq.id)) return true;
            return false;
          }

          if (requestedStart && requestedEnd && locationBoostByEquip.has(eq.id)) return true;

          // Date-only filter without city and no availabilities ⇒ treat as not match
          return false;
        });
        // Display location from the matched equipment/availability context.
        // Prefer requested city (if present and matched via availability), then equipment city.
        const firstEq = matchedEquipment[0];
        const matchedAvailability = firstEq?.availabilities?.find((slot) => {
          if (!requestedCity) return true;
          return slot.locationCity.trim().toLowerCase() === requestedCity;
        });
        const boostedLabel = firstEq ? locationBoostByEquip.get(firstEq.id) : undefined;
        const locationCity =
          matchedAvailability?.locationCity?.trim() ||
          boostedLabel ||
          firstEq?.currentCity?.trim() ||
          firstEq?.availabilities?.[0]?.locationCity?.trim() ||
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
