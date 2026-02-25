# Docker Container Restart Troubleshooting

## Issue: `axiom_runtime-1` container constantly restarting

### Root Causes

The container restarts because:
1. **Server crashes on startup** - The healthcheck fails because the server isn't running
2. **Restart policy** - `restart: unless-stopped` keeps restarting failed containers
3. **Healthcheck failure** - The `/api/features` endpoint isn't responding

### Debugging Steps

1. **Check container logs:**
   ```bash
   docker logs axiom_runtime-1
   # Or with follow:
   docker logs -f axiom_runtime-1
   ```

2. **Check if server is starting:**
   ```bash
   docker exec axiom_runtime-1 ps aux | grep node
   ```

3. **Test healthcheck manually:**
   ```bash
   docker exec axiom_runtime-1 wget -qO- http://127.0.0.1:3000/api/features
   ```

4. **Check file permissions:**
   ```bash
   docker exec axiom_runtime-1 ls -la /app/server/data
   ```

### Common Issues & Fixes

#### Issue 1: Missing directories
**Symptom:** Server crashes with "ENOENT" or "Cannot read directory"
**Fix:** Ensure directories exist:
```bash
docker exec axiom_runtime-1 mkdir -p /app/server/data/pharma/{projects,releases,change_requests,requirements,signatures,audit_events,test_cases,test_runs,binders}
```

#### Issue 2: Import errors
**Symptom:** "Cannot find module" or "SyntaxError" in logs
**Fix:** Rebuild the container:
```bash
docker compose build axiom_runtime
docker compose up axiom_runtime
```

#### Issue 3: Port conflicts
**Symptom:** "EADDRINUSE" error
**Fix:** Check if port 3000 is already in use:
```bash
docker compose down
# Wait a few seconds
docker compose up axiom_runtime
```

#### Issue 4: Bind mount issues
**Symptom:** "Permission denied" errors
**Fix:** Check volume mounts in docker-compose.yml. The volumes should be:
```yaml
volumes:
  - ./server:/app/server
  - /app/server/node_modules  # Anonymous volume to preserve node_modules
  - ./web:/app/web
```

### Quick Fix: Rebuild Container

```bash
# Stop and remove containers
docker compose down

# Rebuild without cache
docker compose build --no-cache axiom_runtime

# Start with logs visible
docker compose up axiom_runtime
```

### Verify Fix

After restarting, check:
1. Container status: `docker ps` (should show "Up" not "Restarting")
2. Healthcheck: `docker inspect axiom_runtime-1 | grep -A 10 Health`
3. Server response: `curl http://localhost:3000/api/features`

### If Still Failing

1. **Run server directly in container:**
   ```bash
   docker exec -it axiom_runtime-1 sh
   cd /app
   node server/server.js
   ```
   This will show the actual error message.

2. **Check for syntax errors:**
   ```bash
   docker exec axiom_runtime-1 node --check server/server.js
   docker exec axiom_runtime-1 node --check server/pharma/api.js
   docker exec axiom_runtime-1 node --check server/pharma/storage.js
   ```

3. **Verify environment variables:**
   ```bash
   docker exec axiom_runtime-1 env | grep -E "PORT|NODE_ENV|ENABLE_PY"
   ```

### Recent Changes That May Cause Issues

If you just added Pharma Mode features:
- Ensure all new directories exist: `test_cases`, `test_runs`, `binders`
- Check that `server/data/pharma` directory is writable
- Verify all imports are correct (we fixed `deleteTestCase` to ensure directory exists)

### Temporary Workaround

To stop the restart loop temporarily:
```bash
docker stop axiom_runtime-1
docker update --restart=no axiom_runtime-1
```

Then debug the issue, fix it, and restart with:
```bash
docker update --restart=unless-stopped axiom_runtime-1
docker start axiom_runtime-1
```
