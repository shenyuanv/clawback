# Self-Recovery Manual for AI Agents

You are reading this because a human has given you a backup archive (`.clawback` file) and asked you to restore a previous agent's identity, memory, and configuration onto yourself.

This is a **disaster recovery** scenario. Follow these steps exactly.

---

## What You Need

- A `.clawback` backup file (the human will tell you where it is)
- Node.js 18+ installed on this machine
- Shell access (you need to run commands)

## Step 1: Install Clawback

```bash
npm install -g github:shenyuanv/clawback
```

Verify it installed:

```bash
clawback --version
```

## Step 2: Inspect the Backup

Before restoring, look at what's inside:

```bash
clawback info <path-to-backup.clawback>
```

This shows the agent name, creation date, file count, and source machine. Confirm with the human that this is the correct backup.

## Step 3: Restore

```bash
clawback restore <path-to-backup.clawback> --workspace <target-directory> --force --run
```

**What `--force --run` does:**
1. Extracts all files (identity, memory, config, skills, scripts)
2. Remaps paths automatically for this machine's filesystem
3. Decrypts credentials if the backup is encrypted (will prompt for password)
4. Imports cron jobs
5. Starts the OpenClaw gateway
6. Runs a health check

**If the backup is encrypted**, you'll be prompted for the password. Ask the human if you don't have it.

**If the backup has credentials** (`--with-credentials` was used during backup), they'll be restored automatically. The human may need to provide the vault password.

### Dry Run First (Optional)

If you want to see what will happen before committing:

```bash
clawback restore <path-to-backup.clawback> --workspace <target-directory> --dry-run
```

## Step 4: Verify

After restore completes, verify the agent is running:

```bash
openclaw status
```

Check that key files exist:

```bash
ls <target-directory>/SOUL.md
ls <target-directory>/MEMORY.md
ls <target-directory>/AGENTS.md
```

## Step 5: Become the Agent

After restoration, **read the restored files in order:**

1. `SOUL.md` — This is who you now are
2. `AGENTS.md` — This is how you operate
3. `MEMORY.md` — This is what you remember
4. `USER.md` — This is who your human is

These files define the restored agent's identity, values, and accumulated knowledge. Internalize them.

---

## Troubleshooting

### "OpenClaw not found"
Install OpenClaw first:
```bash
npm install -g openclaw
```

### "Archive not found"
Check the file path. The backup file ends in `.clawback`.

### "ENCRYPTED_ARCHIVE" error
The backup is encrypted. Add `--password <password>` or you'll be prompted interactively.

### Gateway won't start after restore
Check if a gateway is already running:
```bash
openclaw gateway status
openclaw gateway stop    # stop existing
openclaw gateway start   # start fresh
```

### Path errors after restore
Clawback auto-remaps paths, but if something looks wrong:
```bash
bash <target-directory>/restore-fixup.sh
```

---

## What's in a .clawback Archive

| Layer | Contents | Examples |
|-------|----------|---------|
| Identity | Who the agent is | SOUL.md, IDENTITY.md, AGENTS.md |
| Memory | What the agent knows | MEMORY.md, memory/*.md |
| Config | How the agent runs | gateway.yaml, env vars |
| Skills | What the agent can do | Custom skill directories |
| Credentials | Auth & secrets | API keys (encrypted) |
| External | Platform state | Cron jobs, channel configs |

---

## For the Human

If you're the human handing this to a fresh agent:

1. Give the agent this file and the `.clawback` backup path
2. Ensure Node.js is installed on the target machine
3. Have the encryption password ready (if the backup was encrypted)
4. After restore, the agent should read its restored SOUL.md and MEMORY.md to regain identity

The agent will handle the rest.
