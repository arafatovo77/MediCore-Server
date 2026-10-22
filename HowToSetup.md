# MediCore Server Edition — How to Set Up

MediCore Server Edition runs as two parts that work together: the MediCore app (Node.js + Express) and a PostgreSQL database. The app serves the browser frontend and the API; the database holds every record centrally, so all of your counters share one live data set.

Pick one install target:

| Target | Best for | You need |
|---|---|---|
| **A. Docker Compose on a VPS** | The simplest reliable install, and the easiest to update | A VPS (or any machine) with Docker and the Compose plugin |
| **B. Bare VPS (no Docker)** | Servers where you prefer to manage Node and PostgreSQL yourself | A VPS with Node.js 20 and PostgreSQL 15 or 16 |

Both targets end the same way: open the app in a browser, create the first Admin account, set your clinic name and currency, and add staff accounts.

---

## Before you start — the `.env` file

MediCore is configured through a `.env` file in the project folder. Copy the example and edit it:

```bash
cp .env.example .env
```

Every variable:

| Variable | Required | What it does |
|---|---|---|
| `PORT` | No (default `3000`) | The port the app listens on. Open the app at `http://<server>:<PORT>`. Behind a reverse proxy, the proxy forwards to this port. |
| `DATABASE_URL` | Yes on a bare install; set for you by Compose in the Docker install | The PostgreSQL connection string, in the form `postgres://user:password@host:5432/medicore`. On a bare install you create the user, password and database yourself (Target B). With Docker Compose, the app receives its connection string from `docker-compose.yml`, which builds it from `POSTGRES_PASSWORD` in `.env` — the app and the database can never disagree. |
| `POSTGRES_PASSWORD` | Docker Compose only | The password Compose sets on the database service and passes to the app. Only used by the Docker install; a bare install puts the database password inside `DATABASE_URL` instead. |
| `JWT_SECRET` | Yes | The secret used to sign sign-in tokens. Use a long, random value (32 characters or more) that you have never used anywhere else, and never share it or commit it. If this value changes, everyone is signed out and must sign in again. The server refuses to start without a strong value — set it before first start. |
| `JWT_EXPIRES_IN` | No (default `8h`) | How long a sign-in lasts before the user must sign in again, for example `8h`, `12h` or `1d`. Eight hours covers a normal working shift. |

Keep `.env` private. It contains your database password and your token secret.

---

## Target A — Docker Compose on any VPS

### A1. Install Docker

On a fresh Ubuntu/Debian VPS, install Docker using Docker's own instructions for your operating system, including the Compose plugin. Confirm both work:

```bash
docker --version
docker compose version
```

### A2. Upload the project

Copy the whole MediCore project folder to the server (for example with `scp`, your host's file manager, or Git) and move into it:

```bash
cd /path/to/medicore
ls
# You should see server/, public/, database/, docker-compose.yml and .env.example
```

### A3. Configure `.env`

```bash
cp .env.example .env
nano .env   # or any editor — set POSTGRES_PASSWORD and JWT_SECRET
            # (Compose reads .env and passes both to the services;
            # DATABASE_URL is not used by the Docker install)
```

### A4. Start everything

```bash
docker compose up -d
```

Compose brings up two services: the app and a `postgres:16` database, with a named volume for the database files and a healthcheck so the app waits until the database is ready. Your data persists in that volume across restarts and updates.

The app container applies the database schema automatically every time it starts, so there is no separate schema step on the Docker install.

### A5. Open the app and create the first Admin

Open:

```
http://<your-server-address>:3000
```

(Use the `PORT` from `.env` if you changed it.)

Because no user accounts exist yet, you get the **"Create your Admin account"** screen — see "First run" below. Create the Admin, then continue with the Settings steps there.

### A6. Optional — load the demo data

To evaluate the system with a sample clinic and the four demo accounts, run:

```bash
docker compose exec app npm run db:seed
```

See "Demo data" below for the demo usernames and an important warning.

### A7. Put it on your own domain with HTTPS (recommended)

If staff will reach MediCore over the internet, or from outside one trusted local network, put a reverse proxy in front of the app and serve it over HTTPS. Point your domain's DNS A record at the server first, then use either proxy:

**Caddy** is the shortest route — it obtains and renews HTTPS certificates on its own. A `Caddyfile` like this is enough:

```
yourclinic.com {
    reverse_proxy localhost:3000
}
```

**nginx** works just as well. In outline: create a server block for your domain that proxies to the app port, reload nginx, then obtain a certificate with Certbot and let it add the HTTPS redirect:

```nginx
server {
    listen 80;
    server_name yourclinic.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourclinic.com
```

Once the proxy is live, staff use `https://yourclinic.com` and you can close the app port to direct public access if you wish.

### A8. Updating

Your data is in the named database volume, not in the app container, so updating the app does not touch your records. Still, take a database backup first (see "Backups" below) — it takes a minute.

```bash
# Replace the project files with the new version, keeping your .env
docker compose build
docker compose up -d
# If a release note says the schema changed, also run:
docker compose exec app npm run db:init
```

If you pull prebuilt images instead of building locally, use `docker compose pull` followed by `docker compose up -d`.

---

## Target B — Bare VPS (Node.js + PostgreSQL, no Docker)

### B1. Install Node.js 20

Install Node.js 20 using the NodeSource setup for your distribution, or your operating system's current instructions. Confirm:

```bash
node --version   # should report v20.x
npm --version
```

### B2. Install PostgreSQL 15 or 16

Install PostgreSQL from your distribution's packages (make sure the version is 15 or 16), start it, and enable it at boot. On Ubuntu/Debian the shape is:

```bash
sudo apt update
sudo apt install postgresql
sudo systemctl enable --now postgresql
```

### B3. Create the database user and database

Sign in to PostgreSQL as the `postgres` system user and create a dedicated user and database for MediCore. Choose a strong password and use the same password in `.env`:

```sql
CREATE USER medicore WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE medicore OWNER medicore;
```

Run those two lines in `psql`, for example:

```bash
sudo -u postgres psql -c "CREATE USER medicore WITH PASSWORD 'choose-a-strong-password';"
sudo -u postgres psql -c "CREATE DATABASE medicore OWNER medicore;"
```

### B4. Configure `.env`

```bash
cd /path/to/medicore
cp .env.example .env
nano .env
```

Set at least:

```
PORT=3000
DATABASE_URL=postgres://medicore:choose-a-strong-password@localhost:5432/medicore
JWT_SECRET=replace-with-a-long-random-value
JWT_EXPIRES_IN=8h
```

### B5. Install dependencies and prepare the database

```bash
npm install --omit=dev
npm run db:init          # applies database/schema.sql
npm run db:seed          # optional — also loads the demo data
```

### B6. Start the app

For a first check, start it directly:

```bash
npm start
```

Open `http://<your-server-address>:3000` and confirm you see the "Create your Admin account" screen.

For day-to-day running, use a systemd service so MediCore restarts on reboot and after a crash. Create `/etc/systemd/system/medicore.service`:

```ini
[Unit]
Description=MediCore Server Edition
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/path/to/medicore
ExecStart=/usr/bin/npm start
Restart=on-failure
Environment=NODE_ENV=production
# Run as a non-root user that owns the project folder:
User=medicore

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now medicore
sudo systemctl status medicore
```

### B7. Domain and HTTPS

Use the same reverse-proxy approach as step A7: an nginx server block (or Caddy) for your domain proxying to `http://127.0.0.1:3000`, with HTTPS from Let's Encrypt via Certbot for nginx, or automatic with Caddy.

### B8. Updating

Back up first (see "Backups"), replace the project files with the new version while keeping your `.env`, then:

```bash
npm install --omit=dev
npm run db:init          # only if the release notes say the schema changed
sudo systemctl restart medicore
```

---

## First run — creating the first Admin

MediCore ships with **no default accounts**. There is nothing to sign in with until the first Admin exists.

1. Open the app address in a browser. While zero users exist, the app shows the **"Create your Admin account"** screen instead of a sign-in form.
2. Choose a username and a password (minimum 6 characters — use a longer one) and create the account. Behind the scenes the app calls `POST /api/setup/admin`, which only works while zero users exist; once the first account is created, that route is closed and the setup screen never appears again.
3. You are signed in as Admin. Go to **Settings** and fill in your clinic's **name, address and phone**, then pick your **country** — the currency symbol and ISO code are filled in for you (16 country presets) — and save. Your clinic name, address and phone appear in the app and on every printed invoice and lab report.
4. Still in **Settings**, add an account for each staff member with the right role: Receptionist, Pharmacist or Lab Technician. Each person signs in with their own account and the server only lets them do the work their role allows.

## Demo data

Loading the seed (`npm run db:seed`, or `docker compose exec app npm run db:seed` with Docker) fills the database with a sample clinic and creates these demo accounts:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Admin |
| `reception` | `reception123` | Receptionist |
| `pharmacy` | `pharma123` | Pharmacist |
| `lab` | `labtech123` | Lab Technician |

The seed stores these passwords as bcrypt hashes. Demo data is for evaluation and staff training only. **Delete the demo accounts before entering real patient data** — sign in as Admin and remove them under Settings → User Accounts. If you seeded a database you now want to use for real, the safest start is a fresh database with `npm run db:init` and no seed.

## Changing clinic name and currency

Sign in as Admin and open **Settings**:

- **Clinic name, address, phone:** edit the fields and save. The new details apply everywhere at once, including printed invoices and lab reports, for every signed-in counter.
- **Currency:** pick your country from the list (16 presets) and MediCore sets the currency symbol and ISO code for you — for example, Bangladesh sets ৳ and BDT. You can also edit the symbol by hand for a custom setup. Save, and all amounts on screen and in reports follow the change.

## Backups

There are two different things here, and you want both habits:

**1. Full database backup with `pg_dump` — your real backup.** This is a complete dump of the PostgreSQL database that can be restored with standard PostgreSQL tools.

On a bare install:

```bash
pg_dump -U medicore -h localhost medicore > medicore-backup-2026-10-22.sql
```

With Docker Compose, run it through the database service (check `docker-compose.yml` for the service name, commonly `db`):

```bash
docker compose exec db pg_dump -U medicore medicore > medicore-backup-2026-10-22.sql
```

Keep copies off the server (a second machine or cloud storage you control), and test a restore from time to time. To restore, load the dump into a PostgreSQL database with `psql` in the usual way, point `DATABASE_URL` at it, and restart the app. There is **no in-app restore in the server edition** — restoring is a database operation, done deliberately, by whoever looks after your server.

**2. JSON export from Settings — handy for inspection and migration.** Sign in as Admin → **Settings → Data Export** downloads a full JSON export of your records (`GET /api/export`). Keep it as an extra snapshot, but do not treat it as a substitute for a `pg_dump` backup.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Port already in use / app will not start, address in use | Another program is using the configured `PORT`, or an old copy of the app is still running. Change `PORT` in `.env` (and your proxy target, if you have one), or stop the other program, then start again. With Docker, also check `docker compose ps`. |
| Database connection refused / app starts but every screen errors | PostgreSQL is not running, or `DATABASE_URL` does not match the database you created. Check the database service (`sudo systemctl status postgresql`, or `docker compose ps` and `docker compose logs db`), confirm the host, port, user, password and database name in `DATABASE_URL`, and confirm you ran `npm run db:init`. |
| App complains that `JWT_SECRET` is unset, or signs everyone out / rejects every token | `JWT_SECRET` is missing, empty, or was changed. Set a long random value in `.env` and restart the app. Changing it invalidates all existing tokens by design — everyone signs in again once. |
| Setup screen never appears / cannot create the first Admin | The setup route only works while zero users exist. If any account already exists (including demo accounts from the seed), sign in with that account instead, or start from a fresh database if this really is a new install. |
| Demo accounts still present on a live system | Sign in as Admin → **Settings → User Accounts** and delete `admin`, `reception`, `pharmacy` and `lab` demo accounts if you created your own Admin under a different name, and change or remove any demo account you kept. |
| Forgotten Admin password | Passwords are stored only as bcrypt hashes, so the old password cannot be viewed or recovered. If another Admin account exists, that Admin can reset the password in Settings → User Accounts. If the only Admin password is lost, an operator with database access can reset it directly: generate a bcrypt hash of a new password using the project's bcrypt library, then update that user's row, for example `UPDATE users SET password_hash = '<new-bcrypt-hash>' WHERE username = 'your-admin-username';` in `psql`. Sign in with the new password immediately afterwards and change it in Settings if your workflow requires it. Keep database access limited to people you trust — anyone with it can do this. |
| Printed invoice or report looks wrong | Print from a desktop browser and check the print preview. MediCore uses a dedicated print layout that hides the app screens; make sure print/pop-up blocking is off for the site. |
| Wrong currency on screens or documents | An Admin should check **Settings**: pick the right country preset (or set the symbol directly) and save. All counters pick up the change from the server. |
| A staff member gets "access denied" | Their role does not include that action — for example, a Pharmacist cannot edit patients. That is the role system working as designed. See the role table in `README.md`. Ask an Admin if the person genuinely needs a different role. |
