# Korgo Mini runtime for Void Linux

These assets turn the reviewed Mini stage into two fail-closed runtimes without
mounting the host home:

- `hermes-korgo` is the remote Hermes executable configured in Korgo. It also
  controls a persistent `hermes gateway run` runit service.
- `korgo-workspace` controls TigerVNC/Xvnc plus Openbox on `127.0.0.1:5901`.
  The desktop's existing strict SSH connection forwards that raw RFB stream;
  there is no public VNC listener, VNC password, or noVNC service.

Both processes use bubblewrap with a synthetic `/home/korgo`, explicit
`HERMES_HOME=/state/hermes`, and only these writable host directories:

```text
/home/cjm/.hermes-korgo-stage/tenant/home
/home/cjm/.hermes-korgo-stage/tenant/hermes
/home/cjm/.hermes-korgo-stage/tenant/workspace
/home/cjm/.hermes-korgo-stage/tenant/runtime
/home/cjm/.hermes-korgo-stage/tenant/logs
```

The existing stage root, its old `state.db`, migration material, regular
`~/.hermes`, Docker socket, system D-Bus, SSH keys, and the rest of the host home
are not mounted. Desktop ownership locks, logs, and token files live under the
staged tenant home, not regular `~/.hermes`; the root-owned wrapper reports that
host path through `desktop-contract`.

The uv virtualenv's absolute Python symlink is backed by one validated,
runtime-owned CPython directory below `~/.local/share/uv/python`. That resolved
directory is mounted read-only at the symlink's exact target. The parent
`.local`, uv data, and all other host-home content remain absent.

Inside either sandbox, `/home/korgo/.hermes` is a private tmpfs layered after the
tenant HOME bind, so the host ownership tree and all sibling locks, logs, and
tokens cannot be enumerated. A `serve` launch validates and opens exactly its
host-side 0600 token, exposes only that file at
`/home/korgo/.hermes/desktop-ssh/<ownership-id>/<nonce>.token`, and rewrites the
Hermes argument to that HOME-based path. Runtime state remains separately bound
at `HERMES_HOME=/state/hermes`. The wrapper unlinks the validated host token
after opening it, preserving Hermes's one-shot consumption semantics even
though the sandbox copy itself is a read-only data mount.

## Fixed compatibility contract

- Void packages: `bubblewrap tigervnc openbox xauth dbus-x11 iproute2
  util-linux runit git`
- Hermes `0.20.4`
- commit `c820a5d38321a8d870e5b1ed0d89f8b933dd48e8`
- schema `26`
- display `:1`, geometry `1440x900`, VNC `127.0.0.1:5901`
- expected stage `/home/cjm/.hermes-korgo-stage`

Any pin mismatch, dirty tracked source, unsafe directory, missing command,
pre-existing unowned install target, non-loopback port collision, or direct
unsandboxed stage process aborts launch.
Token launch also aborts for a duplicate/out-of-tree token argument, unsafe or
wrongly owned parent, non-0700 ownership directory, non-0600 file, or anything
other than exactly 64 lowercase hexadecimal bytes.
In particular, the previously observed direct `hermes serve --isolated` process
must be stopped by its current Desktop owner before installation or `ensure`.
The scripts never kill an unproven process.

## Install and operate

Review first; these are future Mini commands and are **not** run by building or
testing this repository:

```bash
# Read-only preflight. This intentionally fails while the old direct staged
# Hermes process exists or while required packages are absent.
./packaging/korgo-mini/install-void-mini check

# Root-authorized package/config/runit installation. No service starts yet.
./packaging/korgo-mini/install-void-mini install --install-packages

# Link the services into runit, still held down.
sudo /usr/local/sbin/install-korgo-mini enable

# Start or idempotently ensure both services after reviewing preflight output.
sudo /usr/local/sbin/install-korgo-mini ensure

# Exact individual controls.
sudo /usr/local/bin/hermes-korgo start|status|stop|ensure
sudo /usr/local/bin/korgo-workspace start|status|stop|ensure
```

Set Korgo's remote Hermes path to `/usr/local/bin/hermes-korgo`. The workspace
pane already forwards Mini port `5901` through the existing strict SSH
ControlMaster. Do not add a firewall exception or bind VNC to a Tailscale/LAN
address.

The persistent gateway and client-owned dashboard are intentionally separate:
`hermes-korgo gateway-foreground` is runit-internal, while normal commands such
as `--version`, `serve --help`, and `serve --isolated ...` pass through the same
sandbox for Desktop SSH lifecycle compatibility.

## Verification

Repository-only static verification:

```bash
bash packaging/korgo-mini/tests/test-static.sh
```

Future Mini verification after explicit authorization:

```bash
sudo /usr/local/sbin/install-korgo-mini status
ss -lntp 'sport = :5901'
```

The sole acceptable VNC row is `127.0.0.1:5901`. Verify WebCTX remains at
`127.0.0.1:8090`, no existing Docker listener changes, and Korgo can open and
reopen the RFB pane over SSH.

## Rollback

```bash
/usr/local/sbin/install-korgo-mini rollback
```

Rollback stops workspace first, stops the managed gateway, and removes only the
two `/var/service` symlinks. It preserves tenant state, the pinned checkout and
venv, migration evidence, regular Hermes state, WebCTX, Docker, SSH, and
Tailscale. Do not copy tenant state backward automatically. Removal of installed
files or tenant data is a separate destructive action requiring explicit review.
