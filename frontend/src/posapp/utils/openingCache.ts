export function hasCachedOpeningData(openingData: any): boolean {
	return !!(
		openingData &&
		openingData.pos_profile &&
		openingData.pos_opening_shift &&
		openingData.pos_opening_shift.user
	);
}

export function isCachedOpeningValidForCurrentUser(
	openingData: any,
	currentUser?: string | null,
): boolean {
	if (!hasCachedOpeningData(openingData)) {
		return false;
	}
	const cachedUser = openingData?.pos_opening_shift?.user;
	if (!currentUser || !cachedUser) {
		return false;
	}
	if (currentUser !== cachedUser) {
		return false;
	}
	// Never resurrect yesterday's shift from cache when the profile enforces
	// closure — the error/offline boot path would otherwise adopt it silently
	// and the server would reject every submit with no obvious way out.
	if (openingData?.force_close_stale_shift) {
		const periodStart = openingData?.pos_opening_shift?.period_start_date;
		if (periodStart) {
			const started = new Date(String(periodStart).replace(" ", "T"));
			const now = new Date();
			const sameDay =
				started.getFullYear() === now.getFullYear() &&
				started.getMonth() === now.getMonth() &&
				started.getDate() === now.getDate();
			if (!Number.isNaN(started.getTime()) && !sameDay && started < now) {
				return false;
			}
		}
	}
	return true;
}

export function getValidCachedOpeningForCurrentUser(
	openingData: any,
	currentUser?: string | null,
) {
	if (!isCachedOpeningValidForCurrentUser(openingData, currentUser)) {
		return null;
	}
	return openingData;
}

export function getCachedOpeningBootstrapSeed(openingData: any) {
	if (!hasCachedOpeningData(openingData)) {
		return null;
	}

	return {
		profileName: openingData?.pos_profile?.name || null,
		profileModified: openingData?.pos_profile?.modified || null,
		openingShiftName: openingData?.pos_opening_shift?.name || null,
		openingShiftUser: openingData?.pos_opening_shift?.user || null,
	};
}
