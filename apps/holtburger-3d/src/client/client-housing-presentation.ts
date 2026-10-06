/** App-local dwelling labels shared by home information and the crystal HUD. */
export function housingTypeLabel(type: number): string {
	switch (type) {
		case 1:
			return "Cottage";
		case 2:
			return "Villa";
		case 3:
			return "Mansion";
		case 4:
			return "Apartment";
		default:
			return `House type ${type}`;
	}
}
