export enum LogLevel {
	Info,
	Warning,
	Error,
	Debug,
}

export function log(content: unknown, level: LogLevel = LogLevel.Info) {
	void content;
	void level;

	if (level === LogLevel.Info) {
		console.info(content);
	} else if (level === LogLevel.Warning) {
		console.warn(content);
	} else if (level === LogLevel.Error) {
		console.error(content);
	} else if (level === LogLevel.Debug) {
		console.debug(content);
	}
}
