# Pinar Cloudflare Worker

Cloudflare Worker backend for **Pinar** visual feedback. Provides remote screenshot hosting on **Cloudflare R2**, annotation history in **Cloudflare D1**, and an **Interactive Web Viewer** (`/v/:id`).

## Features
- 🚀 **Remote Screenshot Upload**: Stores PNG crops directly in Cloudflare R2 (`/shots/:id.png`).
- 🌐 **Interactive Web Viewer (`/v/:id`)**: Responsive web viewer with image zoom, interactive pin badges, and "Copy Prompt for AI" button.
- 🗄️ **Annotation History (`/api/history`)**: Persistent history of annotations, DOM selectors, and comments in Cloudflare D1.
- 🔐 **Installation-scoped Free history**: anonymous per-installation credentials, one-time browser tickets, and owner-filtered history/delete operations.
- ⚡ **Zero Egress Fees**: Hosted on Cloudflare Workers & R2.

## 1-Minute Setup & Deploy

1. **Install Wrangler** (if not installed):
   ```sh
   npm install
   ```

2. **Create R2 Bucket & D1 Database**:
   ```sh
   npx wrangler r2 bucket create pinar-shots
   npx wrangler d1 create pinar-history
   ```
   *(Copy the `database_id` output from wrangler into `wrangler.toml`)*

3. **Initialize D1 Schema**:
   ```sh
   npx wrangler d1 execute pinar-history --file=./schema.sql
   ```

   For an existing database, apply migrations in `migrations/`, including `0003_add_installation_identity.sql`.

4. **Deploy**:
   ```sh
   npm run deploy
   ```

Your worker URL will be output (e.g. `https://pinar-cloud.<your-subdomain>.workers.dev`).

## Extension Configuration

In the Pinar extension Options page (`chrome-extension://<id>/options.html`):
1. Select **Remote Server**.
2. The extension creates an installation ID and private secret locally.
3. Click **History** to exchange a one-time ticket for a private browser session.

JSON/service endpoints live under `/api/*`. Public unlisted viewers remain at `/v/:id`, with screenshots at `/shots/:id.png`.
