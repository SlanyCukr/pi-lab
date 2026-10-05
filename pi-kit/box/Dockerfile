# Test box for pi-kit: a clean Debian + Node image with only the kit installed.
# Build from the pi-kit folder:  docker build -t pi-kit-box -f box/Dockerfile .
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep rsync procps jq \
  && rm -rf /var/lib/apt/lists/*

# Global npm prefix owned by the `node` user, so install.sh --install-pi works without root
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.npm-global/bin:$PATH

COPY --chown=node:node . /opt/pi-kit
USER node
WORKDIR /home/node
RUN /opt/pi-kit/install.sh --sub copilot --install-pi

WORKDIR /workspace
CMD ["pi"]
