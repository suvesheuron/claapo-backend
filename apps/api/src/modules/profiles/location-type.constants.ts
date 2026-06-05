/**
 * Canonical values for the `location` role.
 *
 * A Location provider is one role discriminated by `locationType` (mirroring how
 * the cast role uses `roleType`). The three types map to the categories in the
 * product spec: Bungalow / Villa / Apartments, Studio Set-Ups, and Location
 * Manager.
 *
 * `LOCATION_SUBTYPES_BY_TYPE` is a STARTER list — the official catalog is to be
 * finalized later. The columns (`location_profiles.sub_types`,
 * `location_properties.sub_types`) are free-form `TEXT[]`, so expanding this map
 * never requires a migration. Keep this file the single source of truth.
 */
export const LOCATION_TYPE_BUNGALOW = 'bungalow_villa_apartment';
export const LOCATION_TYPE_STUDIO = 'studio_setup';
export const LOCATION_TYPE_MANAGER = 'location_manager';

export const LOCATION_TYPES = [
  LOCATION_TYPE_BUNGALOW,
  LOCATION_TYPE_STUDIO,
  LOCATION_TYPE_MANAGER,
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];

/** Human-friendly labels for UI / display. */
export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  [LOCATION_TYPE_BUNGALOW]: 'Bungalow / Villa / Apartments',
  [LOCATION_TYPE_STUDIO]: 'Studio Set-Ups',
  [LOCATION_TYPE_MANAGER]: 'Location Manager',
};

/**
 * Bungalow / villa / apartment sub-types. These also appear as common base
 * options in studio_setup and location_manager (see below).
 */
const BUNGALOW_LIST = [
  'Luxury Villa',
  'Modern Villa',
  'Colonial Bungalow',
  'Vintage Bungalow',
  'Heritage Villa',
  'Palace',
  'Old Traditional House',
  'Row House',
  'Parsi Bungalow',
  'Sea-Facing Bungalow',
  'Haveli',
  'Flat Apartment',
  'High Rise Building',
];

/** Studio-setup-specific sub-types (combined with BUNGALOW_LIST at runtime). */
const STUDIO_LIST = [
  'Penthouse',
  'Empty Floor',
  'Green Screen Studio',
  'Podcast Studio',
  'Virtual Studio',
  'Rehearsal Studio',
  'Post Production Studio',
  'Office Setup',
  'Cafe Setup',
  'Restaurant Setup',
  'Street Side / Road Side',
  'Market Setup',
  'Metro / Train Setup',
  'Police / Court / Jail Setup',
  'Hospital Setup',
  'Roadside Area',
  'Temple',
];

/** Location-manager-specific sub-types (combined with BUNGALOW_LIST at runtime). */
const LOCATION_MANAGER_LIST = [
  'Market / Street',
  'Roadside',
  'Grocery Shops / Bakery / Cafe',
  'Office / Corporate Building',
  'School / College / Hostel',
  'Park / Garden',
  'Mall / Gym',
  'Temple / Mosque / Church',
  'Factories / Warehouse / Mill',
  'Airport',
  'Dockyard / Pge',
  'Fort / Heritage Building',
  'Government Buildings',
  'Hotels',
  'Riverside',
  'Village Side',
  'Fields / Open Land',
  'Waterfalls',
  'Jungle Area',
  'Mountains',
  'River',
  'Village',
  'WaterFall',
  'Desert',
];

/**
 * Sub-type options per location type. Free-form — providers may also
 * store values outside this list.
 *
 * Studio Setup and Location Manager each include the Bungalow list as a
 * shared base, so the same residential sub-types are available everywhere.
 */
export const LOCATION_SUBTYPES_BY_TYPE: Record<LocationType, string[]> = {
  [LOCATION_TYPE_BUNGALOW]: [...BUNGALOW_LIST],
  [LOCATION_TYPE_STUDIO]: [...STUDIO_LIST, ...BUNGALOW_LIST],
  [LOCATION_TYPE_MANAGER]: [...LOCATION_MANAGER_LIST, ...BUNGALOW_LIST],
};

export function isValidLocationType(value: string | null | undefined): value is LocationType {
  return !!value && (LOCATION_TYPES as readonly string[]).includes(value);
}
