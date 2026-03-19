import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateReviewDto } from './dto/create-review.dto';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a review for a booking' })
  createReview(@CurrentUser() user: AuthUser, @Body() dto: CreateReviewDto) {
    return this.reviewsService.createReview(user.id, dto);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get reviews I have given' })
  getMyReviews(@CurrentUser() user: AuthUser) {
    return this.reviewsService.getMyReviews(user.id);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get reviews for a user (public)' })
  getReviewsForUser(@Param('userId') userId: string) {
    return this.reviewsService.getReviewsForUser(userId);
  }

  @Get('user/:userId/rating')
  @ApiOperation({ summary: 'Get average rating for a user (public)' })
  getAverageRating(@Param('userId') userId: string) {
    return this.reviewsService.getAverageRating(userId);
  }

  @Get('booking/:bookingId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get reviews for a booking' })
  getReviewsForBooking(@Param('bookingId') bookingId: string) {
    return this.reviewsService.getReviewsForBooking(bookingId);
  }
}
