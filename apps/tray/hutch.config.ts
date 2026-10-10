// @hutch cli=0.25.0
export default {
	scripts: {
		install: ["hutch", "install", "--frozen-lockfile"],
		start: ["hutch", "electrobun", "dev"],
		dev: ["hutch", "electrobun", "dev", "--watch"],
		build: ["hutch", "electrobun", "build", "--env=stable"],
		"build:canary": ["hutch", "electrobun", "build", "--env=canary"],
	},
	electrobun: {
		version: "2.0.3-beta.11",
	},
};
