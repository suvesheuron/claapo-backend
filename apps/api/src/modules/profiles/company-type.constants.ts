/**
 * Canonical company-subtype values stored in CompanyProfile.companyType.
 * The column is still a free-form string for legacy/forward compatibility, but
 * use these constants when matching against features that gate on subtype.
 */
export const COMPANY_TYPE_PRODUCTION_HOUSE = 'production_house';
export const COMPANY_TYPE_AGENCY = 'agency';
export const COMPANY_TYPE_STUDIO = 'studio';
/** Unlocks the Cast Search feature on the company dashboard. */
export const COMPANY_TYPE_CASTING_DIRECTOR = 'casting_director';

export const KNOWN_COMPANY_TYPES = [
  COMPANY_TYPE_PRODUCTION_HOUSE,
  COMPANY_TYPE_AGENCY,
  COMPANY_TYPE_STUDIO,
  COMPANY_TYPE_CASTING_DIRECTOR,
] as const;

export type KnownCompanyType = (typeof KNOWN_COMPANY_TYPES)[number];

export function isCastingDirector(companyType: string | null | undefined): boolean {
  return companyType === COMPANY_TYPE_CASTING_DIRECTOR;
}
