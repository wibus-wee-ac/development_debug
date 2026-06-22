# Remote Runtime Hosts

This module owns Cradle-local remote runtime host configuration and live daemon connections.

It stores configured hosts in `remote_runtime_hosts` and chat-session-to-remote-agent links in
`remote_runtime_session_links`. These rows are Cradle application data. They are not provider
targets, and this module must not write remote host identity into the provider target namespace.

Runtime-native semantics remain owned by provider adapters. The module only knows how to open an
OpenSSH Unix-socket tunnel, speak the `@cradle/remote-agent-protocol` WebSocket protocol, and expose
host-level actions such as health, runtime listing, workspace listing, and live agent listing.

Host configuration is structured Cradle data. Frontends should create SSH hosts with a profile such
as:

```json
{
  "displayName": "Devbox",
  "sshProfile": {
    "hostName": "devbox.example.com",
    "user": "me",
    "port": 2222,
    "auth": "identityFile",
    "identityFilePath": "~/.ssh/id_ed25519"
  }
}
```

`remoteSocketPath` is optional on create and defaults to `~/.cradle/agentd/agent.sock`, matching the
daemon's default remote socket path. Set it only when the remote daemon is configured with a custom
socket.

`auth: "default"` means Cradle does not pass an identity file and lets system OpenSSH use the user's
normal agent and `~/.ssh/config`. `auth: "identityFile"` adds `-i <identityFilePath>`. The service
derives the legacy `sshTarget` column from the profile as `user@hostName` or `hostName`; `port` and
identity file are generated as OpenSSH argv entries at connect time. Raw `connectionConfig.sshArgs`
is retained only as an advanced/internal escape hatch.

For local smoke tests or a controller colocated with a daemon, use `transport: "direct-socket"` plus
`localSocketPath`. That path bypasses SSH and connects directly to a Unix socket. The default
transport is SSH unless a legacy config has `localSocketPath` and no structured SSH profile.

Connection state is process-local and realtime. If the SSH tunnel exits or the daemon WebSocket is
lost, the configured host row remains in the database, active calls fail with a transport error, and
the user must reconnect explicitly.

The first PTY implementation is daemon-level protocol support. Server HTTP routes here intentionally
do not expose an interactive PTY stream yet; PTY sessions are host-level shells, not agent terminals.
