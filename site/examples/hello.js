HB.onEvent((event) => {
	if (event.kind !== 'started') return;
	const self = HB.self();
	HB.print(
		self.name ? `Hello, ${self.name}.` : 'Hello from Holtburger.',
		'info'
	);
	HB.debugLog(`Startup arguments: ${event.args}`);
});
