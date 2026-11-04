HB.onEvent((event) => {
	if (event.kind !== 'lifecycle' || event.data.kind !== 'started') return;
	const self = HB.selfEntity();
	HB.print('info', self ? `Hello, ${self.name}.` : 'Hello from Holtburger.');
	HB.debugLog(`Startup arguments: ${event.data.data.args}`);
});
