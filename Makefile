# Compiles the server and UI into a single executable, build/3pitor. Run it with ./build/3pitor.
BUILD := build

.PHONY: build check-build clean test test-ui test-server

# Older builds also left claude and fixtures/ in build/; clear them out.
build: node_modules
	rm -rf $(BUILD)/3pitor $(BUILD)/claude $(BUILD)/fixtures
	bun build --compile --production src/server/server.ts --outfile $(BUILD)/3pitor

# Checks the app's skills are inside build/3pitor: runs it from an empty folder and fails unless the
# workspace config it serves lists collaborative-draft-editing. `make test` does not run it.
check-build: build
	@dir=$$(mktemp -d); log=$$dir.log; \
	(cd $$dir && OPEN_BROWSER=0 ANTHROPIC_API_KEY=unused exec $(CURDIR)/$(BUILD)/3pitor > $$log 2>&1) & pid=$$!; \
	for i in $$(seq 50); do grep -q 'listening on' $$log 2>/dev/null && break; sleep 0.1; done; \
	url=$$(sed -n 's/.*listening on \([^ ]*\).*/\1/p' $$log); \
	config=$$(curl -fsS $$url/api/workspace-config); status=$$?; \
	kill $$pid; wait $$pid 2>/dev/null; rm -rf $$dir $$log; \
	echo "$$config"; \
	[ $$status -eq 0 ] && echo "$$config" | grep -q '"collaborative-draft-editing"'

# Unit tests, which need no API key. Server tests run as plain Bun code. UI tests run against happy-dom, a simulated
# browser page, which src/ui/test-setup.ts sets up; it stays out of the server tests so they see Bun's real globals.
test: test-server test-ui

test-server: node_modules
	bun test src/server src/shared

test-ui: node_modules
	bun test --preload ./src/ui/test-setup.ts src/ui

node_modules: package.json bun.lock
	bun install
	touch node_modules

clean:
	rm -rf $(BUILD)
