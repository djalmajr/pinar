import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Pinar",
		identifier: "dev.pinar.local",
		version: "0.1.4",
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
