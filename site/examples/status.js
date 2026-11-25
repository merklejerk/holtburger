/** Send one status update when the script starts. */
async function sendStatus() {
	const self = HB.self();
	try {
		const response = await HB.postJson({
			url: 'http://localhost:9999/status',
			bodyJson: { name: self.name, health: self.health }
		});
		if (!response.ok) {
			HB.print(`Status service returned HTTP ${response.status}.`, 'warn');
			return;
		}
		HB.print('Status sent.', 'info');
	} catch (error) {
		HB.print(error instanceof Error ? error.message : String(error), 'error');
	}
}
HB.onEvent((event) => {
	if (event.kind === 'started') {
		void sendStatus();
	}
});
