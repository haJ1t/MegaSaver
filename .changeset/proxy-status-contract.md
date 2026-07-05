---
"@megasaver/gui": patch
---

Fix the conversation-proxy toggle in the Token saver view. The GUI read a stale
`ProxyStatus` shape (`running`/`url`/`port`) after the server contract changed to
`enabled`/`routed`/`routeConflict`/`reconcileBlocked`, so the toggle looked dead
(clicking it silently enabled the proxy server-side but the UI never reflected
it). The client type + view now read the real server fields, the bridge emits the
loopback `url`, a compile-time contract test guards future client/server drift,
and a helper line clarifies the conversation proxy is separate from the context
daemon. Also removes the dead "Restart claude" button (it POSTed to a
non-existent `/api/proxy/restart-claude` route — 404); the documented design is a
manual restart (no osascript), so the panel now shows plain guidance instead.
