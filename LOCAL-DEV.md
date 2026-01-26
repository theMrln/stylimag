# Stylo Local Development Guide

## Prerequisites

- Node.js v22+
- npm v10+
- MongoDB 6 (running locally)

## Starting Stylo

### 1. Ensure MongoDB is running

```bash
# Check if MongoDB is running
lsof -ti:27017 && echo "MongoDB running" || echo "MongoDB not running"

# Start MongoDB (macOS with Homebrew)
mongod --config /usr/local/etc/mongod.conf --fork
```

### 2. Start the development servers

```bash
npm run dev
```

This starts:
- **Frontend** (Vite): http://localhost:3000
- **GraphQL API** (nodemon): http://localhost:3030

Both servers have hot reload enabled.

## Stopping Stylo

### Option 1: Ctrl+C in the terminal

Press `Ctrl+C` in the terminal where `npm run dev` is running.

### Option 2: Kill by port

```bash
# Kill frontend and GraphQL servers
lsof -ti:3000,3030 | xargs kill -9
```

### Option 3: Kill all Node processes (nuclear option)

```bash
pkill -f "node.*stylo"
```

## Troubleshooting

### Port already in use

**Symptom:** `Error: listen EADDRINUSE: address already in use :::3030` (or 3000)

**Solution:**
```bash
# Find and kill the process using the port
lsof -ti:3030 | xargs kill -9

# Or for frontend
lsof -ti:3000 | xargs kill -9

# Then restart
npm run dev
```

### EMFILE: too many open files

**Symptom:** `Error: EMFILE: too many open files, watch`

**Solution:** This was fixed by using nodemon instead of Node's built-in `--watch`. If it recurs:

```bash
# Increase file limit for current session
ulimit -n 10240

# Then restart
npm run dev
```

### MongoDB connection failed

**Symptom:** Application crashes or can't connect to database

**Solution:**
```bash
# Check if MongoDB is running
lsof -ti:27017

# If not running, start it
mongod --config /usr/local/etc/mongod.conf --fork

# Verify connection
mongosh --eval "db.runCommand({ping:1})"
```

### GraphQL server not restarting on file changes

**Symptom:** Changes to `graphql/` files don't trigger a restart

**Solution:**
```bash
# Manually trigger restart by touching a file
touch graphql/app.js

# Or type 'rs' in the terminal and press Enter (nodemon command)
```

### Frontend shows blank page or API errors

**Symptom:** Frontend loads but shows errors or can't fetch data

**Causes & solutions:**
1. **GraphQL not running** — Check terminal output, restart if needed
2. **Wrong ports** — Ensure frontend is on 3000 and GraphQL on 3030
3. **Missing SE_GRAPHQL_TOKEN** — Regenerate token:
   ```bash
   DOTENV_CONFIG_PATH=.env NODE_OPTIONS="--require dotenv/config" \
     npm run --prefix graphql generate-service-token --silent
   ```
   Then paste the output into `SE_GRAPHQL_TOKEN` in `.env`

### Clean restart

When all else fails:

```bash
# Stop everything
lsof -ti:3000,3030 | xargs kill -9 2>/dev/null

# Clear any stale state
rm -rf graphql/yeditingsession/*

# Restart
npm run dev
```

## Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both frontend and GraphQL |
| `npm run dev:front` | Start frontend only |
| `npm run dev:graphql` | Start GraphQL only |
| `npm run lint` | Check code formatting |
| `npm run lint:fix` | Fix code formatting |

## Ports Reference

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3000 | http://localhost:3000 |
| GraphQL API | 3030 | http://localhost:3030 |
| MongoDB | 27017 | mongodb://127.0.0.1:27017 |

## Environment Variables

Key variables in `.env`:

- `DATABASE_URL` — MongoDB connection string
- `SE_GRAPHQL_TOKEN` — Service token for export (generate with command above)
- `JWT_SECRET_*` — Auth secrets (change in production)
- `HUMANID_*`, `ZOTERO_*`, `HYPOTHESIS_*` — Optional OAuth provider credentials
