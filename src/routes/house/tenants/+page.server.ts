import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserById } from '$lib/server/auth';
import { houseService } from '$lib/server/services/houseService';
import { tenantService } from '$lib/server/services/tenantService';
import { db } from '$lib/server/db';
import { characters } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ cookies }) => {
	const userId = cookies.get('userId');

	if (!userId) {
		throw redirect(303, '/login');
	}

	const user = await getUserById(parseInt(userId));

	if (!user) {
		cookies.delete('userId', { path: '/' });
		throw redirect(303, '/login');
	}

	const house = await houseService.getActiveHouse(user.id);
	if (!house) {
		throw redirect(303, '/');
	}

	const [roster, vacantBedrooms, libraryCount] = await Promise.all([
		tenantService.getActiveTenants(house.id),
		tenantService.getVacantBedrooms(house.id),
		db
			.select({ id: characters.id })
			.from(characters)
			.where(eq(characters.userId, user.id))
			.then((rows) => rows.length)
	]);

	// Shortlists are drawn per room, on demand, when the player opens a vacancy —
	// so there is nothing house-wide to load here.
	return {
		user,
		house,
		tenants: roster,
		vacantBedrooms,
		libraryCount
	};
};
