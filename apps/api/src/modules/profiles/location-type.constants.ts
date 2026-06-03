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
 * Starter sub-type options per location type. Free-form — providers may also
 * store values outside this list. Swap in the official catalog when it lands.
 */
export const LOCATION_SUBTYPES_BY_TYPE: Record<LocationType, string[]> = {
  [LOCATION_TYPE_BUNGALOW]: [
    'Modern Bungalow',
    'Parsi Bungalow',
    'Heritage Villa',
    'Sea-facing Villa',
    'Apartment',
    'Penthouse',
    'Farmhouse',
    'Cottage',
  ],
  [LOCATION_TYPE_STUDIO]: [
    'Market Setup',
    'Hospital Set',
    'Court Set',
    'Office Set',
    'Police Station Set',
    'Chroma / Green Screen',
    'Cyclorama',
    'White Studio',
    'Black Studio',
  ],
  [LOCATION_TYPE_MANAGER]: [
    'City Coverage',
    'Outstation Coverage',
    'Permissions & Liaison',
    'Recce Services',
  ],
};

export function isValidLocationType(value: string | null | undefined): value is LocationType {
  return !!value && (LOCATION_TYPES as readonly string[]).includes(value);
}
