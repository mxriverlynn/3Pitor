# Compiles the server and UI into a single executable in build/, next to the files it needs at runtime:
# the seed workspace and the SDK's native claude binary for this platform. Run it with ./build/3pitor.
BUILD := build
CLAUDE_BIN := $(shell bun -e "console.log(require.resolve('@anthropic-ai/claude-agent-sdk-' + process.platform + '-' + process.arch + '/claude'))")

.PHONY: build clean

build: node_modules
	rm -rf $(BUILD)/3pitor $(BUILD)/fixtures
	bun build --compile --production src/server/server.ts --outfile $(BUILD)/3pitor
	mkdir -p $(BUILD)/fixtures
	cp -R src/fixtures/workspace $(BUILD)/fixtures/workspace
	cp $(CLAUDE_BIN) $(BUILD)/claude

node_modules: package.json bun.lock
	bun install
	touch node_modules

clean:
	rm -rf $(BUILD)
