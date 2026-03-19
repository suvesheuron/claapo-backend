import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReview(userId: string, dto: CreateReviewDto) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: dto.bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.status !== 'accepted' && booking.status !== 'locked') {
      throw new BadRequestException(
        'Reviews can only be left for accepted or locked bookings',
      );
    }

    const isRequester = booking.requesterUserId === userId;
    const isTarget = booking.targetUserId === userId;
    if (!isRequester && !isTarget) {
      throw new ForbiddenException('You are not part of this booking');
    }

    const revieweeUserId = isRequester
      ? booking.targetUserId
      : booking.requesterUserId;

    const existing = await this.prisma.review.findUnique({
      where: {
        bookingId_reviewerUserId: {
          bookingId: dto.bookingId,
          reviewerUserId: userId,
        },
      },
    });
    if (existing) {
      throw new BadRequestException(
        'You have already submitted a review for this booking',
      );
    }

    return this.prisma.review.create({
      data: {
        bookingId: dto.bookingId,
        reviewerUserId: userId,
        revieweeUserId,
        rating: dto.rating,
        text: dto.text,
      },
    });
  }

  async getReviewsForUser(userId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { revieweeUserId: userId },
      include: {
        reviewer: {
          select: {
            id: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items: reviews };
  }

  async getMyReviews(userId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { reviewerUserId: userId },
      include: {
        reviewee: {
          select: {
            id: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items: reviews };
  }

  async getAverageRating(userId: string) {
    const result = await this.prisma.review.aggregate({
      where: { revieweeUserId: userId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return {
      averageRating: result._avg.rating ?? 0,
      totalReviews: result._count.rating,
    };
  }

  async getReviewsForBooking(bookingId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { bookingId },
      include: {
        reviewer: {
          select: {
            id: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
        reviewee: {
          select: {
            id: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items: reviews };
  }
}
