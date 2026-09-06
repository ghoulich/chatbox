# Local network tools: third-party libraries

The Android `NetworkToolsPlugin` is compiled into the APK with these pinned
libraries. They run in the Chatbox app process; none of them is an MCP server.

| Library | Version | License | Purpose |
|---|---:|---|---|
| dnsjava | 3.6.4 | BSD-3-Clause | DNS record queries |
| SSHJ | 0.40.0 | Apache-2.0 | SSH client and host-key verification |
| SNMP4J | 3.9.6 | Apache-2.0 | SNMP v2c/v3 GET and bounded WALK |
| Bouncy Castle (`bcprov`, `bcpkix`, `bcutil`) | 1.80 | MIT | SSH cryptographic primitives |
| asn-one | 0.6.0 | Apache-2.0 | SSHJ ASN.1 support |
| SLF4J API | 2.0.17 | MIT | SSHJ logging API |

The build intentionally does not expose SNMP SET. SSHJ versions older than
0.38.0 must not be substituted because they are affected by the Terrapin issue.
For SSH, Bouncy Castle is registered under the private `ChatboxBC` provider
name so Android's stripped system provider named `BC` cannot shadow X25519 or
Ed25519. The system provider is not removed or replaced. A non-Curve25519 KEX
fallback remains available for vendor ROMs that reject provider registration.
