#!/bin/sh
# Installed as ~/.pi/agent/bin/rg, next to the real binary rg.real (pi-lab wip/arg-fixes, 2026-10-24).
# pi's grep tool runs `rg --no-config`, so no config file can set the engine. An argument with look-around or a
# backreference gets --engine=auto, which switches to PCRE2 for it (find-gaps run to 2026-10-22: 23 of 62 grep regex
# errors). Not for every pattern: PCRE2 also accepts `onClick={() =>` and then silently matches nothing (`()` is an
# empty group), where rg's own error lets arg-fixes search it as literal text. A later -P/--engine still wins.
# Rollback: mv ~/.pi/agent/bin/rg.real ~/.pi/agent/bin/rg
real="${0%/*}/rg.real"
for a in "$@"; do
	case $a in
	*'(?='* | *'(?!'* | *'(?<='* | *'(?<!'* | *\\[1-9]* | *'\k<'*) exec "$real" --engine=auto "$@" ;;
	esac
done
exec "$real" "$@"
