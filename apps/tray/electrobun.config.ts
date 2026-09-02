import { readFileSync } from "node:fs";
import type { ElectrobunConfig } from "electrobun";

// The product version lives in the root package.json (see AGENTS.md); the app
// bundle carries the same number.
const version: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

export default {
	app: {
		name: "Pinar",
		identifier: "dev.pinar.local",
		version,
	},
	runtime: {
		exitOnLastWindowClosed: false,
	},
	build: {
		mac: {
			bundleCEF: false,
			codesign: Boolean(process.env.ELECTROBUN_DEVELOPER_ID),
			createDmg: true,
			icons: "icon.iconset",
			notarize: Boolean(
				process.env.ELECTROBUN_APPLEAPIKEYPATH ||
					process.env.ELECTROBUN_APPLEID,
			),
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
		copy: {
			"src/assets/tray-on.svg": "views/assets/tray-on.svg",
			"src/assets/tray-off.svg": "views/assets/tray-off.svg",
			"src/assets/tray-on.pdf": "views/assets/tray-on.pdf",
			"src/assets/tray-on.png": "views/assets/tray-on.png",
			"src/assets/tray-on@2x.png": "views/assets/tray-on@2x.png",
			"src/assets/tray-off.png": "views/assets/tray-off.png",
			"helpers/pinar": "Helpers/pinar",
			"helpers/pinar.js": "Helpers/pinar.js",
			"helpers/ensure.sh": "Helpers/ensure.sh",
		},
		cottontail: {
			entrypoint: "src/bun/index.ts",
		},
		mainProcess: "cottontail",
	},
	scripts: {
		postBuild: "scripts/macos-agent-app.mjs",
		postWrap: "scripts/macos-agent-app.mjs",
	},
	release: {
		baseUrl:
			process.env.PINAR_UPDATE_BASE_URL ??
			"https://github.com/djalmajr/pinar/releases/latest/download",
		generatePatch: true,
	},
} satisfies ElectrobunConfig;
