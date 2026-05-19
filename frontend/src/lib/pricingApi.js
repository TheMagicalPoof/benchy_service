const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
export const pricingApiEnabled =
	import.meta.env.VITE_ENABLE_PRICING_API === '1' || API_BASE_URL.length > 0;

export async function fetchPricing() {
	const response = await fetch(`${API_BASE_URL}/api/pricing`);
	if (!response.ok) {
		throw new Error(`Pricing request failed: ${response.status}`);
	}

	return response.json();
}

export function materialItems(materials) {
	return materials
		.filter((material) => !material.done)
		.map((material) => ({ name: material.name }));
}
