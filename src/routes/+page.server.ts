import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserById } from '$lib/server/auth';
import { houseService } from '$lib/server/services/houseService';

export const load: PageServerLoad = async ({ cookies }) => {
	const userId = cookies.get('userId');

	if (!userId) {
		throw redirect(303, '/login');
	}

	const user = await getUserById(parseInt(userId));

	if (!user) {
		// Invalid session, clear cookie and redirect
		cookies.delete('userId', { path: '/' });
		throw redirect(303, '/login');
	}

	// The active house drives the whole Home page: with one, we show a resume
	// card; without one, starting a house is the only thing on offer.
	const activeHouse = await houseService.getActiveHouse(user.id);
	const summary = activeHouse ? await houseService.getHouseSummary(activeHouse.id, user.id) : null;
	const houseCount = (await houseService.getAllHouses(user.id)).length;

	return {
		user,
		summary,
		houseCount
	};
};
