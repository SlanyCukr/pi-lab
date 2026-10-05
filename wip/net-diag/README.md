# net-diag

Two scripts from the 2026-10-05 hunt for intermittent "no route to host" errors (see REPORT.md "How to work here").

- `sniff.py <secs>` (root, no packages): counts outbound SYNs per second and lists who sends TCP resets or ICMP unreachables back; writes `/tmp/sniff.json`.
- `natfill.py <N> [hold] [batch] [gap]`: holds N extra TCP connections to 1.1.1.1:443 while probing new ones, to measure how much connection headroom the line has. It pushes the whole line over its cap for a few seconds.
