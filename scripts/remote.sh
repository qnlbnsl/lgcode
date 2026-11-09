#!/usr/bin/env bash
# Runs this repository's tests on another computer over Secure Shell (SSH), so
# long test runs do not compete with other work on this computer.
#
# Usage: scripts/remote.sh <command> [arguments]
#
# Commands:
#   doctor            report what the other computer has and lacks
#   sync              copy this working tree there, uncommitted changes included
#   install           sync, then install dependencies and the test browser there
#   check             install, then run `pnpm check` there in a free slot
#   test [files...]   sync, then run Vitest there on the given files, or on all
#   browser           sync, then run the browser tests there in a free slot
#   run <command...>  sync, then run any command in the copy there
#   clean             delete this working tree's copy there
#
# Settings, read from the environment:
#   LGCODE_REMOTE_HOST   SSH host or alias (default 192.168.141.18)
#   LGCODE_REMOTE_USER   user on that host (default: SSH's own choice)
#   LGCODE_REMOTE_ROOT   folder there that holds the copies, relative to the
#                        user's home unless absolute (default Work/lgcode)
#   LGCODE_REMOTE_NAME   name of this copy (default: this working tree's
#                        folder name, so each worktree gets its own copy)
#   LGCODE_REMOTE_SLOTS  how many `check` and `browser` runs may use the other
#                        computer at once (default 2); later runs wait
#   LGCODE_REMOTE_SPARE_CPUS  processors left free there (default 2); every
#                        remote command runs on the others
#   LGCODE_REMOTE_MEMORY  memory all remote commands share there, as a
#                        systemd size (default 80G)
#
# The copy holds every file Git would see in this working tree: tracked files
# and new files that are not ignored. Ignored files, such as node_modules and
# private state, are never sent. The exit status is the remote command's.
# The live checks are not offered, because they use the owner's harness
# accounts on this computer.

set -euo pipefail

host=${LGCODE_REMOTE_HOST:-192.168.141.18}
user=${LGCODE_REMOTE_USER:-}
root_dir=${LGCODE_REMOTE_ROOT:-Work/lgcode}
slots=${LGCODE_REMOTE_SLOTS:-2}
spare=${LGCODE_REMOTE_SPARE_CPUS:-2}
memory=${LGCODE_REMOTE_MEMORY:-80G}

top=$(git rev-parse --show-toplevel)
name=${LGCODE_REMOTE_NAME:-$(basename "$top")}
case $name in
  "" | . | .. | */*) echo "remote: the copy name '$name' is not a plain folder name" >&2; exit 2 ;;
esac
case $slots in
  "" | *[!0-9]* | 0) echo "remote: LGCODE_REMOTE_SLOTS must be a whole number above 0" >&2; exit 2 ;;
esac
case $spare in
  "" | *[!0-9]*) echo "remote: LGCODE_REMOTE_SPARE_CPUS must be a whole number" >&2; exit 2 ;;
esac
case $memory in
  [0-9]*[KMGT] | [0-9]*) ;;
  *) echo "remote: LGCODE_REMOTE_MEMORY must be a size such as 80G" >&2; exit 2 ;;
esac

target=${user:+$user@}$host
dir=$root_dir/$name
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30
  -o ControlMaster=auto -o "ControlPath=$HOME/.ssh/lgcode-remote-%C" -o ControlPersist=10m)

# Bash source that every remote command starts with: enter the copy, use the
# Node.js version that .nvmrc names when the other computer has nvm, and define
# lgcode_limited, which runs a command within the processor and memory limits.
prelude() {
  printf 'set -euo pipefail\ncd %q\nspare=%q\nmemory=%q\n' "$dir" "$spare" "$memory"
  cat <<'SH'
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use --silent >/dev/null 2>&1 || { echo "remote: nvm has no Node.js $(cat .nvmrc); run make remote-install" >&2; exit 1; }
fi
# Every remote command runs on all processors but the last $spare, inside one
# systemd slice that all of them share, so together they never use more than
# $memory. Without a systemd user session, only the processor limit applies.
lgcode_limited() {
  # The processors this session may use, in order, minus the last $spare.
  local allowed cpus=() part
  allowed=$(sed -n 's/^Cpus_allowed_list:[[:space:]]*//p' /proc/self/status)
  for part in ${allowed//,/ }; do
    if [[ $part == *-* ]]; then cpus+=($(seq "${part%-*}" "${part#*-}")); else cpus+=("$part"); fi
  done
  local keep=$(( ${#cpus[@]} - spare ))
  [ "$keep" -ge 1 ] || keep=1
  local list
  list=$(IFS=,; echo "${cpus[*]:0:keep}")
  if systemctl --user show-environment >/dev/null 2>&1; then
    local unit="$HOME/.config/systemd/user/lgcode-remote.slice"
    local want="[Slice]"$'\n'"MemoryMax=$memory"$'\n'"MemorySwapMax=0"
    if [ "$(cat "$unit" 2>/dev/null)" != "$want" ]; then
      mkdir -p -- "${unit%/*}"
      printf '%s\n' "$want" >"$unit"
      systemctl --user daemon-reload
    fi
    echo "remote: limits: $keep of ${#cpus[@]} processors ($list), memory $memory shared"
    systemd-run --user --scope --quiet --collect --slice=lgcode-remote.slice -- taskset -c "$list" bash -c "set -eo pipefail"$'\n'"$1"
  else
    echo "remote: limits: $keep of ${#cpus[@]} processors ($list); no systemd user session, so no memory limit"
    taskset -c "$list" bash -c "set -eo pipefail"$'\n'"$1"
  fi
}
SH
}

# Runs Bash source on the other computer in a login shell, reading it from
# standard input, so no quoting passes through the remote shell.
remote_bash() {
  ssh "${ssh_opts[@]}" "$target" 'bash -l -s'
}

# Runs the given Bash source in the copy.
in_copy() {
  { prelude; printf 'lgcode_limited %q\n' "$1"; } | remote_bash
}

# Runs the given Bash source in the copy once one of the slots is free.
in_slot() {
  { prelude; printf 'slots=%q\nlocks=%q\n' "$slots" "$root_dir/.slots"; cat <<'SH'
case $locks in /*) ;; *) locks=$HOME/$locks ;; esac
mkdir -p -- "$locks"
waited=0
while :; do
  for i in $(seq 1 "$slots"); do
    exec 9>"$locks/$i"
    if flock -n 9; then
      echo "remote: slot $i of $slots on $(hostname), $(nproc) processors, load $(cut -d' ' -f1 /proc/loadavg)"
SH
    printf '      lgcode_limited %q\n' "$1"
    cat <<'SH'
      exit $?
    fi
    exec 9>&-
  done
  [ "$waited" = 1 ] || { echo "remote: all $slots slots are busy; waiting"; waited=1; }
  sleep 5
done
SH
  } | remote_bash
}

sync_copy() {
  local changed head
  head=$(git -C "$top" rev-parse --short HEAD)
  changed=$(git -C "$top" status --porcelain | wc -l | tr -d ' ')
  echo "remote: copying $top at $head ($changed changed paths) to $target:$dir"
  printf 'mkdir -p -- %q\n' "$dir" | remote_bash
  # Every path Git ignores here, including .git/info/exclude, is left out, and
  # the per-folder .gitignore rules also keep the copy's own installed
  # dependencies and test output from being deleted on the other computer.
  git -C "$top" ls-files -z --others --ignored --exclude-standard --directory |
    tr '\0' '\n' | sed 's|^|/|' |
    rsync -a --delete --filter=':- .gitignore' --exclude=/.git --exclude-from=- \
      -e "ssh ${ssh_opts[*]}" "$top/" "$target:$dir/"
}

install_copy() {
  in_copy "$(cat <<'SH'
want=$(cat .nvmrc)
have=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)
[ "$have" = "$want" ] || { echo "remote: Node.js $want is needed and $have is installed" >&2; exit 1; }
pnpm_version=$(node -p 'require("./package.json").packageManager.split("@")[1]')
[ "$(pnpm --version 2>/dev/null)" = "$pnpm_version" ] || npm install -g --silent "pnpm@$pnpm_version"
pnpm install --frozen-lockfile --prefer-offline
pnpm exec playwright install chromium
SH
)"
}

command=${1:-}
[ $# -gt 0 ] && shift

case $command in
  doctor)
    { printf 'dir=%q\nwant=%q\n' "$dir" "$(cat "$top/.nvmrc")"; cat <<'SH'
echo "host: $(hostname), $(nproc) processors, load $(cut -d' ' -f1 /proc/loadavg)"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" && nvm use --silent "$want" >/dev/null 2>&1 || true
for tool in node pnpm git rsync flock; do
  if command -v "$tool" >/dev/null; then echo "ok: $tool $("$tool" --version 2>&1 | head -1)"; else echo "missing: $tool"; fi
done
have=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)
[ "$have" = "$want" ] && echo "ok: Node.js $want" || echo "missing: Node.js $want (have $have)"
[ -d "$dir/node_modules" ] && echo "ok: dependencies installed in $dir" || echo "missing: dependencies in $dir (run make remote-install)"
SH
    } | remote_bash
    ;;
  sync)
    sync_copy
    ;;
  install)
    sync_copy
    install_copy
    ;;
  check)
    sync_copy
    install_copy >/dev/null
    in_slot 'pnpm check'
    ;;
  browser)
    sync_copy
    in_slot 'pnpm test:browser'
    ;;
  test)
    sync_copy
    files=""
    [ $# -eq 0 ] || files=$(printf '%q ' "$@")
    in_copy "pnpm exec vitest run $files"
    ;;
  run)
    [ $# -gt 0 ] || { echo "remote: run needs a command" >&2; exit 2; }
    sync_copy
    in_copy "$(printf '%q ' "$@")"
    ;;
  clean)
    printf 'rm -rf -- %q\n' "$dir" | remote_bash
    echo "remote: deleted $target:$dir"
    ;;
  *)
    sed -n '2,/^$/s/^# \{0,1\}//p' "$0" >&2
    exit 2
    ;;
esac
