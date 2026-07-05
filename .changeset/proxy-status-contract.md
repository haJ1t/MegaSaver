---
"@megasaver/gui": minor
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

Adds a **Finish stopping** action: turning the proxy off only un-routes it while
the supervisor drains its listener (to not break an in-flight session). The panel
now surfaces the `draining` state and a "Finish stopping" button that POSTs
`{ enabled:false, confirmClientsRestarted:true }` so the operator can fully stop
the listener (freeing port 8787 / releasing the API key) without dropping to the
CLI — previously only `mega proxy stop --confirm-clients-restarted` could finish
the drain. The copy warns to restart Claude first.
