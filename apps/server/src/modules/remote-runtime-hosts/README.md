# Remote Runtime Hosts

This module owns Cradle-local remote runtime host configuration and live daemon connections.

It stores configured hosts in `remote_runtime_hosts` and chat-session-to-remote-agent links in
`remote_runtime_session_links`. These rows are Cradle application data. They are not provider
targets, and this module must not write remote host identity into the provider target namespace.

Runtime-native semantics remain owned by provider adapters. The module only knows how to open an
OpenSSH Unix-socket tunnel, speak the `@cradle/remote-agent-protocol` WebSocket protocol, and expose
host-level actions such as health, runtime listing, workspace listing, and live agent listing.

Connection state is process-local and realtime. If the SSH tunnel exits or the daemon WebSocket is
lost, the configured host row remains in the database, active calls fail with a transport error, and
the user must reconnect explicitly.

The first PTY implementation is daemon-level protocol support. Server HTTP routes here intentionally
do not expose an interactive PTY stream yet; PTY sessions are host-level shells, not agent terminals.
