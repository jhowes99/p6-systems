# P6 Systems application image (Studio UI + API + Runtime + document processing)
# Internal package layout may still use legacy axiom_* names (ADR-004).
FROM node:20-alpine

LABEL org.opencontainers.image.title="P6 Systems App" \
      org.opencontainers.image.description="P6 Studio/Runtime/Verify monolith" \
      org.opencontainers.image.vendor="P6 Systems"

WORKDIR /app

# Python + deps for control narrative generator (server spawns python3)
RUN apk add --no-cache python3 py3-pip

# Install server deps first (better layer caching)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Copy app source
COPY server ./server
COPY web ./web

# Control narrative generator (Python) — required for /api/narrative/generate
# Use a venv to avoid "externally-managed-environment" (PEP 668) on Alpine
COPY control_narrative_gen ./control_narrative_gen
RUN python3 -m venv /app/control_narrative_gen/.venv \
  && /app/control_narrative_gen/.venv/bin/pip install --no-cache-dir -r /app/control_narrative_gen/requirements.txt
ENV NARRATIVE_PYTHON=/app/control_narrative_gen/.venv/bin/python3

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Basic healthcheck (busybox wget is available in alpine)
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/features >/dev/null || exit 1

CMD ["node", "server/server.js"]
