#!/usr/bin/env bash
#
# Verifies that this machine has everything needed to run Enat locally.
# Run it immediately after cloning; see README.md § Setup.
#
#   ./scripts/preflight.sh
#
# Exits 0 if every required tool is present and new enough, 1 otherwise.
# Missing optional tools are reported but never fail the run.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
    GREEN=''; RED=''; YELLOW=''; DIM=''; RESET=''
fi

failures=0
warnings=0

pass() { printf '  %s✓%s %-10s %s%s%s\n' "$GREEN" "$RESET" "$1" "$DIM" "$2" "$RESET"; }
fail() { printf '  %s✗%s %-10s %s\n' "$RED" "$RESET" "$1" "$2"; failures=$((failures + 1)); }
warn() { printf '  %s!%s %-10s %s\n' "$YELLOW" "$RESET" "$1" "$2"; warnings=$((warnings + 1)); }

# First integer in a version string: "v22.11.0" -> 22, "openjdk 17.0.9" -> 17.
major_version() {
    printf '%s' "$1" | grep -oE '[0-9]+' | head -1
}

# check_tool <name> <required|optional> <command> <min-major> <install-hint>
check_tool() {
    local name="$1" tier="$2" cmd="$3" min="$4" hint="$5"
    local report; report="$( [ "$tier" = required ] && echo fail || echo warn )"

    if ! command -v "$cmd" >/dev/null 2>&1; then
        "$report" "$name" "not found — $hint"
        return
    fi

    local raw found
    raw="$("$cmd" --version 2>&1 | head -1)"
    found="$(major_version "$raw")"

    if [ -z "$found" ]; then
        # Present but unparseable output. Don't block on a cosmetic mismatch.
        warn "$name" "installed, but could not read version from: $raw"
    elif [ -n "$min" ] && [ "$found" -lt "$min" ]; then
        "$report" "$name" "found v$found, need v$min+ — $hint"
    else
        pass "$name" "v$found"
    fi
}

echo
echo "Enat preflight"
echo "${DIM}$REPO_ROOT${RESET}"
echo

echo "Required"
node_major="$(major_version "$(cat "$REPO_ROOT/.nvmrc" 2>/dev/null || echo 22)")"
check_tool node required node "$node_major" "install Node $node_major LTS, or run 'nvm use'"
check_tool npm  required npm  10 "ships with Node $node_major"
check_tool git  required git  2  "https://git-scm.com/downloads"
check_tool java required java 17 "install a JDK 17+ (Android Gradle Plugin requires it)"

echo
echo "Required for cloud work (backend deploys, Firestore, Gmail API)"
check_tool gcloud optional gcloud "" "https://cloud.google.com/sdk/docs/install"
check_tool docker optional docker 20 "https://docs.docker.com/get-docker/"

echo
echo "Repository"
if [ -f "$REPO_ROOT/.env" ]; then
    pass ".env" "present"
else
    warn ".env" "missing — run: cp .env.example .env"
fi

if git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    pass "git repo" "$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
else
    fail "git repo" "not a git repository"
fi

echo
if [ "$failures" -gt 0 ]; then
    printf '%s%d required check(s) failed.%s Install the tools above, then re-run.\n' \
        "$RED" "$failures" "$RESET"
    exit 1
fi

if [ "$warnings" -gt 0 ]; then
    printf '%sReady, with %d warning(s).%s Cloud tools are only needed once you\n' \
        "$YELLOW" "$warnings" "$RESET"
    printf 'reach the backend and Gmail tickets.\n'
else
    printf '%sAll checks passed.%s\n' "$GREEN" "$RESET"
fi

echo "Next: see README.md § Setup."
