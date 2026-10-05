# Fresh Debian with only what setup-root.sh would install (minus podman), then the user side as a plain user.
# Build from the repo root: podman build -t localhost/pi-host-test -f server/test/Dockerfile .
# Run: podman run --rm localhost/pi-host-test
FROM docker.io/library/debian:trixie-slim
RUN apt-get update -qq && apt-get install -y -qq git rsync jq curl ca-certificates xz-utils procps > /dev/null \
 && useradd --create-home --shell /bin/bash tester
COPY --chown=tester:tester pi-kit /home/tester/pi-lab/pi-kit
COPY --chown=tester:tester server /home/tester/pi-lab/server
USER tester
WORKDIR /home/tester/pi-lab
# Twice: the second run must change nothing that matters (idempotent).
RUN ./server/install-user.sh --no-services --sub openai > /tmp/run1.log 2>&1 || { tail -30 /tmp/run1.log; exit 1; }
RUN ./server/install-user.sh --no-services --sub openai --public-host pi.example.com > /tmp/run2.log 2>&1 || { tail -30 /tmp/run2.log; exit 1; }
CMD ["bash", "/home/tester/pi-lab/server/test/check.sh"]
