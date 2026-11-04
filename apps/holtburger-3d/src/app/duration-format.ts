/** Compact elapsed/remaining duration text shared by client UI surfaces. */
export function formatDuration(seconds: number): string {
	const rounded = Math.round(seconds);
	const sign = rounded < 0 ? "−" : "";
	const total = Math.abs(rounded);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const remainder = total % 60;
	const parts: string[] = [];
	if (hours > 0) {
		parts.push(`${hours}h`);
		if (minutes > 0) parts.push(`${minutes}m`);
		return sign + parts.join(" ");
	}
	if (minutes > 0) parts.push(`${minutes}m`);
	if (remainder > 0 || parts.length === 0) parts.push(`${remainder}s`);
	return sign + parts.join(" ");
}
