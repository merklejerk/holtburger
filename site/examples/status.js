/** Send one status update when the script starts. */
async function sendStatus() {
	const self = HB.selfEntity();
	if (self === null) return;
	try {
		const response = await HB.postJson({
			url: 'http://localhost:9999/status',
			bodyJson: { name: self.name, health: self.health }
		});
		if (!response.ok) {
			HB.print('warn', `Status service returned HTTP ${response.status}.`);
			return;
		}
		HB.print('info', 'Status sent.');
	} catch (error) {
		HB.print('error', error instanceof Error ? error.message : String(error));
	}
}
HB.onEvent((event) => {
	if (event.kind === 'lifecycle' && event.data.kind === 'started') {
		void sendStatus();
	}
});
