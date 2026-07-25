import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["dist/**", "node_modules/**"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				...globals.browser,
			},
		},
		rules: {
			"no-console": "off",
		},
	},
	{
		files: ["src/lib/game/commit/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "../geometry/geometry-manager",
							message:
								"Commit artifacts must depend on geometry contracts, not GeometryManager.",
						},
						{
							name: "../systems/components",
							message:
								"Commit artifacts must own their env-cell render contracts.",
						},
						{
							name: "../systems/env-cell-system",
							message:
								"Commit artifacts must not depend on EnvCellSystem implementation types.",
						},
						{
							name: "../systems/static-object-system",
							message:
								"Commit artifacts must not depend on StaticObjectSystem implementation types.",
						},
					],
				},
			],
		},
	},
	{
		files: ["scripts/**/*.mjs", "vite.config.ts"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				...globals.node,
			},
		},
	},
);
