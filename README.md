# Purna (Discord Voice Recorder Bot)

Purna is a self-hostable Discord bot named after **Pūrṇa**, disciple of the Buddha. Invite it to your server, then run a slash command from a voice channel to start/stop recording.

## Features

- Slash command: `/record action:start|stop`
- Records each speaker into separate `.ogg` (Opus) files
- Easy self-hosting on a DigitalOcean droplet or any Linux VPS
- Minimal setup with `node` + `npm`

## 1) Create your Discord app and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application named `Purna`.
3. In **Bot** settings:
   - Create/reset bot token.
   - Enable **Server Members Intent** only if you later extend features (not required right now).
4. In **OAuth2 -> URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Connect`, `View Channels`, `Speak`
5. Invite the bot URL to your server.

## 2) Install and run locally

```bash
npm install
cp .env.example .env
# fill .env
npm start
```

`.env` variables:

- `DISCORD_TOKEN` - bot token
- `DISCORD_CLIENT_ID` - application ID
- `DISCORD_GUILD_ID` - your server ID (guild-scoped command registration is instant)
- `RECORDINGS_DIR` - optional custom output folder

## 3) Use the bot in Discord

1. Join a voice channel.
2. Run `/record action:start`.
3. Speak with others in the same channel.
4. Run `/record action:stop`.
5. Bot responds with where files were written (relative paths).

## 4) Deploy on a DigitalOcean droplet (Ubuntu)

```bash
# as root or sudo user
apt update && apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# app folder
mkdir -p /opt/purna && cd /opt/purna
# copy your project files here (git clone or rsync/scp)
npm install --omit=dev
cp .env.example .env
nano .env
```

### Run as a systemd service

Create `/etc/systemd/system/purna.service`:

```ini
[Unit]
Description=Purna Discord Recorder Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/purna
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=root
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:

```bash
systemctl daemon-reload
systemctl enable --now purna
systemctl status purna
journalctl -u purna -f
```

## Notes / constraints

- Recording bots may trigger legal/privacy obligations. Always inform participants and follow local laws/server policy.
- Purna stores raw recording files on disk; add retention/cleanup to fit your policy.
- This implementation writes one file per speaking user per session.
