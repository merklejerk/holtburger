const { relative, resolve, sep } = require("node:path");

const hostBinary =
	process.platform === "win32"
		? "holtburger-3d-host.exe"
		: "holtburger-3d-host";
const packagedDirectoryRoots = new Set([
	"dist",
	"dist-electron",
	"node_modules",
]);

/** Keep the packaged application to executable output and runtime dependencies. */
function ignoreApplicationSource(path) {
	const relativePath = relative(__dirname, path);
	// Forge currently supplies app-relative slash-prefixed paths despite Packager's absolute-path type.
	const applicationPath = relativePath.startsWith(`..${sep}`)
		? path.replace(/^[/\\]+/, "")
		: relativePath;
	if (applicationPath === "" || applicationPath === "package.json")
		return false;
	const [root, dependencyName] = applicationPath.split(/[/\\]/);
	if (
		root === "node_modules" &&
		[
			".bin",
			".cache",
			".ignored",
			".pnpm",
			".tmp",
			".vite",
			"electron",
		].includes(dependencyName)
	) {
		return true;
	}
	return !packagedDirectoryRoots.has(root);
}

module.exports = {
	packagerConfig: {
		asar: true,
		extraResource: [
			resolve(__dirname, "../../target/release", hostBinary),
			resolve(__dirname, "../../LICENSE.md"),
		],
		ignore: ignoreApplicationSource,
	},
	makers: [
		{
			name: "@electron-forge/maker-zip",
		},
	],
};
