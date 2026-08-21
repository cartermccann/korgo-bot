#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scripts=(
  "$ROOT/install-void-mini"
  "$ROOT/hermes-korgo"
  "$ROOT/korgo-workspace"
  "$ROOT/korgo-workspace-session"
  "$ROOT/korgo-mini-common"
)

for script in "${scripts[@]}"; do
  bash -n "$script"
done

grep -q -- '--unshare-all' "$ROOT/korgo-mini-common"
grep -q -- '--share-net' "$ROOT/korgo-mini-common"
grep -q -- '--clearenv' "$ROOT/korgo-mini-common"
grep -q -- '--cap-drop ALL' "$ROOT/korgo-mini-common"
grep -q -- 'korgo_bwrap_dir /etc 0555' "$ROOT/korgo-mini-common"
grep -q -- '--setenv HERMES_HOME /state/hermes' "$ROOT/korgo-mini-common"
grep -q -- 'KORGO_DESKTOP_LOCK_DIR="$KORGO_TENANT_HOME/.hermes/desktop-ssh"' "$ROOT/korgo-mini-common"
grep -q -- '"$tenant/home/.hermes/desktop-ssh"' "$ROOT/install-void-mini"
grep -q -- '--bind "$KORGO_TENANT_HOME" /home/korgo' "$ROOT/korgo-mini-common"
grep -q -- '--tmpfs /home/korgo/.hermes' "$ROOT/korgo-mini-common"
grep -q -- '--chmod 0700 /home/korgo/.hermes' "$ROOT/korgo-mini-common"
grep -q -- 'korgo_assert_secure_directory "$KORGO_TENANT_HOME/.hermes" 700' "$ROOT/korgo-mini-common"
grep -q -- '--ro-bind-data "$KORGO_TOKEN_FD"' "$ROOT/korgo-mini-common"
grep -q -- 'KORGO_HERMES_ARGS\[token_arg_index\]="$sandbox_token_path"' "$ROOT/korgo-mini-common"
grep -qF -- 'korgo_add_venv_python_runtime_mount' "$ROOT/korgo-mini-common"
grep -qF -- 'KORGO_BWRAP_ARGS+=(--ro-bind "$python_runtime_root" "$python_link_root")' "$ROOT/korgo-mini-common"
grep -qF -- '"$runtime_home"/.local/share/uv/python/cpython-*/bin/python*' "$ROOT/korgo-mini-common"
grep -q -- 'korgo_assert_no_direct_stage_conflict' "$ROOT/hermes-korgo"
grep -q -- 'exec -a "$0" bwrap' "$ROOT/korgo-mini-common"
grep -q -- 'cmdline_is_direct_stage_conflict' "$ROOT/korgo-mini-common"
grep -qF -- 'sv status "$service_link" 2>/dev/null | grep -q '\''^run:'\''' "$ROOT/korgo-mini-common"
if grep -qF -- 'if sv check "$service_link" >/dev/null 2>&1; then' "$ROOT/korgo-mini-common"; then
  echo 'ensure treats a healthy held-down runit service as running' >&2
  exit 1
fi
grep -qF -- 'local dir="$RUNIT_ROOT/$name"' "$ROOT/install-void-mini"
if grep -qF -- 'local name="$1" foreground="$2" dir="$RUNIT_ROOT/$name"' "$ROOT/install-void-mini"; then
  echo 'write_service expands name before it is initialized under set -u' >&2
  exit 1
fi

grep -q -- '-rfbport "$port"' "$ROOT/korgo-workspace-session"
grep -q -- '-localhost yes' "$ROOT/korgo-workspace-session"
grep -q -- '-SecurityTypes None' "$ROOT/korgo-workspace-session"
grep -q -- 'refusing non-loopback VNC listener' "$ROOT/korgo-workspace-session"
grep -q -- '\[\[ "$port" == 5901 \]\]' "$ROOT/korgo-workspace-session"
grep -q -- '/usr/local/libexec/korgo-mini/korgo-mini-common' "$ROOT/hermes-korgo"
grep -q -- '/usr/local/libexec/korgo-mini/korgo-workspace-session' "$ROOT/korgo-workspace"
grep -q -- "desktop-contract" "$ROOT/hermes-korgo"

if grep -q -- 'KORGO_RUNTIME_HOST_HOME' "$ROOT/korgo-mini-common"; then
  echo 'regular host home reference found' >&2
  exit 1
fi

if grep -Eq -- '--(ro-)?bind[[:space:]]+/home([[:space:]]|$)' "$ROOT/korgo-mini-common"; then
  echo 'broad host /home bind found' >&2
  exit 1
fi
if grep -Eq -- '--(ro-)?bind[[:space:]]+/run([[:space:]]|$)' "$ROOT/korgo-mini-common"; then
  echo 'broad host /run bind found' >&2
  exit 1
fi
if grep -Eq -- '(0\.0\.0\.0:5901|--host[=[:space:]]+0\.0\.0\.0)' "${scripts[@]}" "$ROOT/README.md"; then
  echo 'public VNC listener found' >&2
  exit 1
fi

for action in start status stop ensure; do
  grep -q -- "$action" "$ROOT/hermes-korgo"
  grep -q -- "$action" "$ROOT/korgo-workspace"
done

"$ROOT/install-void-mini" --help >/dev/null
KORGO_MINI_COMMON="$ROOT/korgo-mini-common" "$ROOT/hermes-korgo" wrapper-help >/dev/null
KORGO_MINI_COMMON="$ROOT/korgo-mini-common" KORGO_MINI_WORKSPACE_SESSION="$ROOT/korgo-workspace-session" \
  "$ROOT/korgo-workspace" wrapper-help >/dev/null

tmpdir="$(mktemp -d "$ROOT/tests/.tmp.XXXXXX")"
trap 'rm -rf -- "$tmpdir"' EXIT
printf '/stage/venvs/hermes/bin/python\0/stage/hermes-agent/bin/hermes\0serve\0--isolated\0' >"$tmpdir/direct.cmdline"
printf '/usr/local/bin/hermes-korgo\0--ro-bind\0/stage/venvs/hermes\0/opt/korgo-venv\0--\0/opt/korgo-venv/bin/hermes\0serve\0' >"$tmpdir/sandboxed.cmdline"
(
  # shellcheck source=../korgo-mini-common
  source "$ROOT/korgo-mini-common"
  KORGO_STAGE_ROOT=/stage
  KORGO_VENV_ROOT=/stage/venvs/hermes
  korgo_cmdline_is_direct_stage_conflict "$tmpdir/direct.cmdline"
  ! korgo_cmdline_is_direct_stage_conflict "$tmpdir/sandboxed.cmdline"

  KORGO_RUNTIME_UID="$(id -u)"
  KORGO_RUNTIME_GID="$(id -g)"
  KORGO_AGENT_ROOT=/stage/hermes-agent
  KORGO_VENV_ROOT=/stage/venvs/hermes
  KORGO_TENANT_HOME="$tmpdir/tenant-home"
  KORGO_TENANT_HERMES_HOME="$tmpdir/tenant-hermes"
  KORGO_TENANT_WORKSPACE="$tmpdir/workspace"
  KORGO_TENANT_RUNTIME="$tmpdir/runtime"
  KORGO_TENANT_X11="$tmpdir/runtime/X11-unix"
  KORGO_DESKTOP_LOCK_DIR="$KORGO_TENANT_HOME/.hermes/desktop-ssh"
  owner_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  nonce=0123456789abcdef
  owner_dir="$KORGO_DESKTOP_LOCK_DIR/$owner_id"
  host_token="$owner_dir/$nonce.token"
  mkdir -p "$owner_dir"
  chmod 0700 "$KORGO_TENANT_HOME/.hermes" "$KORGO_DESKTOP_LOCK_DIR" "$owner_dir"
  printf '%064d' 0 >"$host_token"
  chmod 0600 "$host_token"

  korgo_build_base_bwrap no
  home_bind_index=-1
  hermes_mask_index=-1
  for ((index = 0; index < ${#KORGO_BWRAP_ARGS[@]}; index++)); do
    if [[ "${KORGO_BWRAP_ARGS[index]}" == --bind && "${KORGO_BWRAP_ARGS[index + 1]:-}" == "$KORGO_TENANT_HOME" ]]; then
      home_bind_index=$index
    fi
    if [[ "${KORGO_BWRAP_ARGS[index]}" == --tmpfs && "${KORGO_BWRAP_ARGS[index + 1]:-}" == /home/korgo/.hermes ]]; then
      hermes_mask_index=$index
    fi
  done
  (( home_bind_index >= 0 && hermes_mask_index > home_bind_index ))

  korgo_prepare_session_token_mount serve --ssh-session-token-file "$host_token" --isolated
  sandbox_token="/home/korgo/.hermes/desktop-ssh/$owner_id/$nonce.token"
  [[ "${KORGO_HERMES_ARGS[*]}" == "serve --ssh-session-token-file $sandbox_token --isolated" ]]
  [[ ! -e "$host_token" ]]
  [[ "$(sed -n 's/^pos:[[:space:]]*//p' "/proc/$BASHPID/fdinfo/$KORGO_TOKEN_FD")" == 0 ]]
  sandbox_token_found=false
  host_token_found=false
  for arg in "${KORGO_BWRAP_ARGS[@]}"; do
    [[ "$arg" != "$sandbox_token" ]] || sandbox_token_found=true
    [[ "$arg" != "$host_token" ]] || host_token_found=true
  done
  [[ "$sandbox_token_found" == true && "$host_token_found" == false ]]
)

echo 'PASS: korgo-mini shell syntax and fail-closed static contracts'
