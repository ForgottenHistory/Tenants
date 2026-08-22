import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserById } from '$lib/server/auth';
import { houseService } from '$lib/server/services/houseService';
import { tenantService } from '$lib/server/services/tenantService';

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

	const activeHouse = await houseService.getActiveHouse(user.id);
	if (!activeHouse) {
		throw redirect(303, '/');
	}

	const summary = await houseService.getHouseSummary(activeHouse.id, user.id);
	if (!summary) {
		throw redirect(303, '/');
	}

	// Which rooms are leased, so the existing-rooms list can say what each one is
	// doing rather than just naming it.
	const roster = await tenantService.getActiveTenants(activeHouse.id);
	const occupantByBedroom: Record<number, string> = {};
	for (const entry of roster) {
		if (entry.tenant.bedroomId) {
			occupantByBedroom[entry.tenant.bedroomId] = entry.character.name;
		}
	}

	return {
		user,
		house: summary.house,
		bedrooms: summary.bedrooms,
		occupantByBedroom
	};
};
