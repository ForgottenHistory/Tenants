import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserById } from '$lib/server/auth';
import { houseService } from '$lib/server/services/houseService';
import { relationService } from '$lib/server/services/relationService';
import { houseSceneService } from '$lib/server/services/houseSceneService';

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

	const [events, relations, sceneSummaries] = await Promise.all([
		relationService.getAllEvents(activeHouse.id),
		relationService.getHouseRelations(activeHouse.id),
		houseSceneService.getSummarisedScenes(activeHouse.id)
	]);

	return { user, house: activeHouse, events, relations, sceneSummaries };
};
