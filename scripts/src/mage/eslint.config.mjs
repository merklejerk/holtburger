import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["node_modules/**", "package-lock.json"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
		},
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			globals: {
				HB: "readonly",
				Holtburger: "readonly",
			},
		},
	},
	{
		files: ["build.mjs"],
		languageOptions: {
			globals: globals.node,
		},
	},
);
