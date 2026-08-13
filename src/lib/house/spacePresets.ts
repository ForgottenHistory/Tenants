/**
 * Shared-space presets offered during house setup.
 *
 * These are only starting suggestions — a house's spaces live in the
 * `shared_spaces` table and can be renamed, added to, or expanded later.
 * `defaultOn` decides what is pre-checked on the setup form.
 */
export interface SpacePreset {
	name: string;
	kind: 'kitchen' | 'lounge' | 'yard' | 'utility' | 'other';
	description: string;
	capacity: number;
	defaultOn: boolean;
}

export const SPACE_PRESETS: SpacePreset[] = [
	{
		name: 'Kitchen',
		kind: 'kitchen',
		description:
			'The heart of the house. Someone is usually cooking, eating, or leaning against a counter talking.',
		capacity: 4,
		defaultOn: true
	},
	{
		name: 'Living Room',
		kind: 'lounge',
		description:
			'Couches, a television, and the room everyone drifts through. The default place to find company.',
		capacity: 6,
		defaultOn: true
	},
	{
		name: 'Back Yard',
		kind: 'yard',
		description:
			'Open air behind the house. Good for quiet conversations, phone calls, and avoiding everyone inside.',
		capacity: 5,
		defaultOn: true
	},
	{
		name: 'Basement',
		kind: 'utility',
		description:
			'Cool, dim, and slightly unfinished. Storage, laundry, and whatever the tenants have made of it.',
		capacity: 3,
		defaultOn: false
	},
	{
		name: 'Garage',
		kind: 'utility',
		description: 'Concrete floor and a roll-up door. Projects, bikes, and boxes nobody has unpacked.',
		capacity: 3,
		defaultOn: false
	},
	{
		name: 'Front Porch',
		kind: 'yard',
		description: 'A few steps and somewhere to sit. Where people end up when they want to be found.',
		capacity: 3,
		defaultOn: false
	}
];

export const SPACE_KINDS = ['kitchen', 'lounge', 'yard', 'utility', 'other'] as const;

/** Bedroom-count bounds for the setup form. A house is defined by its rooms. */
export const MIN_BEDROOMS = 1;
export const MAX_BEDROOMS = 12;
export const DEFAULT_BEDROOMS = 4;

export const DEFAULT_STARTING_BALANCE = 5000;
export const DEFAULT_BASE_RENT = 800;
