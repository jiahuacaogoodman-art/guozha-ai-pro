export function isNumeric(val: unknown) {
	return (
		!Number.isNaN(Number.parseFloat(String(val))) &&
		Number.isFinite(Number(val))
	)
}