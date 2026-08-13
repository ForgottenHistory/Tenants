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

	// No house to show — Home is where you start one.
	if (!activeHouse) {
		throw redirect(303, '/');
	}

	const summary = await houseService.getHouseSummary(activeHouse.id, user.id);

	if (!summary) {
		throw redirect(303, '/');
	}

	const roster = await tenantService.getActiveTenants(activeHouse.id);

	return { user, summary, tenants: roster };
};
