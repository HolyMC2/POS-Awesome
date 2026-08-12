export const restaurantTipFromPercent = (orderTotal: number, percent: number): number =>
	Math.round(orderTotal * percent / 100);

export const shouldShowRestaurantTips = (
	hasTipsCapability: boolean,
	isRecordOnly: boolean,
	hasActiveOrder: boolean,
): boolean => hasTipsCapability && isRecordOnly && hasActiveOrder;
