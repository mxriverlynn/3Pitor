# Compiles the server and UI into a single executable in build/, next to the files it needs at runtime:
# the seed workspace and the SDK's native claude binary for this platform. Run it with ./build/3pitor.
BUILD := build
CLAUDE_BIN := $(shell bun -e "console.log(require.resolve('@anthropic-ai/claude-agent-sdk-' + process.platform + '-' + process.arch + '/claude'))")

.PHONY: build clean test test-ui test-server

build: node_modules
	rm -rf $(BUILD)/3pitor $(BUILD)/fixtures
	bun build --compile --production src/server/server.ts --outfile $(BUILD)/3pitor
	mkdir -p $(BUILD)/fixtures
	cp -R src/fixtures/workspace $(BUILD)/fixtures/workspace
	cp $(CLAUDE_BIN) $(BUILD)/claude

# Unit tests, which need no API key. Server tests run as plain Bun code. UI tests run against happy-dom, a simulated
# browser page, which src/ui/test-setup.ts sets up; it stays out of the server tests so they see Bun's real globals.
test: test-server test-ui

test-server: node_modules
	bun test src/server

test-ui: node_modules
	bun test --preload ./src/ui/test-setup.ts src/ui

node_modules: package.json bun.lock
	bun install
	touch node_modules

clean:
	rm -rf $(BUILD)
