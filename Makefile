# Runs the tests on another computer, so long runs do not compete with other
# work on this one. See docs/remote-checks.md.
#
#   make remote-doctor                  what the other computer has and lacks
#   make remote-install                 copy, install dependencies and the browser
#   make remote-check                   copy, then pnpm check
#   make remote-test FILES="a.test.ts"  copy, then Vitest on those files
#   make remote-browser                 copy, then the browser tests
#   make remote-run CMD="pnpm -r typecheck"
#   make remote-clean                   delete this working tree's copy

REMOTE_HOST ?= 192.168.141.18
REMOTE_USER ?=
REMOTE_ROOT ?= Work/lgcode
REMOTE_NAME ?=
REMOTE_SLOTS ?= 2
REMOTE_SPARE_CPUS ?= 2
REMOTE_MEMORY ?= 80G

export LGCODE_REMOTE_HOST := $(REMOTE_HOST)
export LGCODE_REMOTE_USER := $(REMOTE_USER)
export LGCODE_REMOTE_ROOT := $(REMOTE_ROOT)
export LGCODE_REMOTE_NAME := $(REMOTE_NAME)
export LGCODE_REMOTE_SLOTS := $(REMOTE_SLOTS)
export LGCODE_REMOTE_SPARE_CPUS := $(REMOTE_SPARE_CPUS)
export LGCODE_REMOTE_MEMORY := $(REMOTE_MEMORY)

REMOTE := scripts/remote.sh

.PHONY: remote-doctor remote-sync remote-install remote-check remote-test remote-browser remote-run remote-clean

remote-doctor:
	@$(REMOTE) doctor

remote-sync:
	@$(REMOTE) sync

remote-install:
	@$(REMOTE) install

remote-check:
	@$(REMOTE) check

remote-test:
	@$(REMOTE) test $(FILES)

remote-browser:
	@$(REMOTE) browser

remote-run:
	@test -n '$(CMD)' || { echo 'remote-run needs CMD="..."' >&2; exit 2; }
	@$(REMOTE) run $(CMD)

remote-clean:
	@$(REMOTE) clean
