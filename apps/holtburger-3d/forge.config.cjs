const { rename } = require("node:fs/promises");
const { join, relative, resolve, sep } = require("node:path");

const hostBinary =
	process.platform === "win32"
		? "holtburger-3d-host.exe"
		: "holtburger-3d-host";
// Release CI supplies the already-built target binary; ordinary local packaging builds natively.
const hostPath = process.env.HOLTBURGER_PACKAGE_HOST
	? resolve(process.env.HOLTBURGER_PACKAGE_HOST)
	: resolve(__dirname, "../../target/release", hostBinary);
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
	hooks: {
		async packageAfterExtract(_config, buildPath, _version, platform) {
			if (platform !== "darwin") return;
			// The macOS ZIP maker retains only the .app. Keep original notices inside it.
			const resources = join(buildPath, "Electron.app/Contents/Resources");
			for (const notice of ["LICENSE", "LICENSES.chromium.html"])
				await rename(join(buildPath, notice), join(resources, notice));
		},
	},
	packagerConfig: {
		asar: true,
		icon: resolve(__dirname, "../../assets/branding/icon"),
		extendInfo: { CFBundleIconFile: "holtburger.icns" },
		extraResource: [
			hostPath,
			resolve(__dirname, "../../LICENSE.md"),
			resolve(__dirname, "../../assets/branding/icon.png"),
		],
		ignore: ignoreApplicationSource,
	},
	makers: [
		{
			name: "@electron-forge/maker-zip",
		},
	],
};
