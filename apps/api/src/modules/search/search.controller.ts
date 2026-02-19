import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { SearchCrewQueryDto, SearchVendorsQueryDto } from './dto/search-query.dto';

@ApiTags('search')
@Controller('search')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('crew')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Search crew (skill, city, date-range, rate, availability)' })
  searchCrew(@CurrentUser() user: AuthUser, @Query() query: SearchCrewQueryDto) {
    return this.searchService.searchCrew(user.id, user.role, query);
  }

  @Get('vendors')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Search vendors by type' })
  searchVendors(@CurrentUser() user: AuthUser, @Query() query: SearchVendorsQueryDto) {
    return this.searchService.searchVendors(user.id, user.role, query);
  }
}
