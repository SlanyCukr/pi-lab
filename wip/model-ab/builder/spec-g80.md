Implement this change (frontend only):

Why: shares were printed with a fixed digit count (`pctFormat(0|1)`), so any
share under half the last digit read as absence ("3 · 0 %" on an outlet
profile's sourcing rows, a 1-in-3 000 failure rate as "0,0 %" on /admin) and
one just short of the whole read "100 %".

What: `fmtShare(format, share, digits, { bare })` in `lib/format.ts`, beside
`pctFormat`. A share in (0, 1) whose printed text equals the printed 0 or 1
becomes "< 1 %" / "< 0,1 %" or "> 99 %" / "> 99,9 %" (locale number, a
non-breaking space after the sign); exact 0 and 1, and binary noise within
1e-9 of them, print "0 %" / "100 %"; NaN, negatives and values above 1 print
exactly as before. The bound test reads the printed text, so Intl's decimal
half-away rounding (0.005 → "1 %") is respected. `bare` prints the digits
without the sign for "%" columns.

This is a snapshot of the media_monitoring repo (git-initialised; do not commit). Write or extend tests for your change and run them. Acceptance: an independent test file is run after you finish.
Scope: `frontend/lib/format.ts` plus a new test file. Only the formatter; do not move call sites.
Commands: `cd frontend && npx vitest run lib/format.test.ts <your test file>`, `npx tsc --noEmit`.
