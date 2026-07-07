# Production backend — SharePoint Lists + Power Automate

This guide turns the local (IndexedDB) app into a **team-shared** app, using
Microsoft 365 tools you already have. Nothing in the React code needs rewriting:
the app talks to **one HTTP endpoint** with a simple JSON contract, controlled by
two env vars:

```
VITE_DATA_SOURCE=remote
VITE_SHEETS_API_URL=<your Power Automate HTTP trigger URL>
```

When `VITE_DATA_SOURCE=remote`, the app:

- **reads** by `GET`ting that URL and expecting a flat JSON payload (below), and
- **writes** by `POST`ing a JSON body with an `action` field.

You build that one endpoint as a **Power Automate flow** over **SharePoint Lists**.

---

## Architecture

```
Browser (React, static hosting)
        │  GET  → all roadmap data (JSON)
        │  POST → { action, ...fields }
        ▼
Power Automate flow ("When an HTTP request is received")
        ▼
SharePoint Lists (Projects, Teams, Domains, Statuses, Priorities)
SharePoint document library (Cookiebot report files)
```

---

## Step 1 — Create the SharePoint site & Lists

Create (or pick) a SharePoint **Team site**, e.g. `Roadmap`. Add these Lists.
Column names below are suggestions; the flow maps them to the JSON the app needs.

### List: `Projects`
| Column | Type | Notes |
|---|---|---|
| Title | Single line | use as the **project id** (e.g. `PLAT-1`) — or add a separate `ProjectId` column |
| Domain | Single line (or Choice) | must match a Domains item id, lowercased (e.g. `platform`) |
| Name | Single line | |
| Description | Multiple lines | |
| TimelineStart | Date | |
| TimelineEnd | Date | |
| Status | Choice / Single line | must match a Statuses label |
| Priority | Choice / Single line | must match a Priorities label |
| Owner | Single line | |
| Teams | Single line | comma-separated team ids, e.g. `core,design` |
| Link | Hyperlink / Single line | |
| Progress | Number | 0–100 |

### List: `Teams`
| Column | Type |
|---|---|
| Title | Single line (team **id**, e.g. `core`) |
| Label | Single line (display name) |
| Color | Single line (hex, e.g. `#8b5cf6`) |

### List: `Domains`
| Column | Type |
|---|---|
| Title | Single line (domain **id**, lowercased) |
| Name | Single line (display name) |

### List: `Statuses`
| Column | Type |
|---|---|
| Title | Single line (status **label**, e.g. `In Progress`) |
| Color | Single line (hex) |
| SortOrder | Number |

### List: `Priorities`
Same shape as `Statuses` (Title = label, Color, SortOrder).

### Document library: `Reports`
A standard document library for **Cookiebot report files**. Add metadata columns:
`SiteName` (Single line) and `UploadedBy` (Person), if you want to filter by site.

---

## Step 2 — Build the Power Automate flow (the API)

Create one **Instant cloud flow** with the trigger **"When an HTTP request is
received"**. This gives you a URL (with a `?sig=…` signature) — that URL is your
`VITE_SHEETS_API_URL`.

Set the trigger **Method** to *blank/Any* so it accepts both `GET` (reads) and
`POST` (writes), then branch on the method using `triggerOutputs()?['method']`.

### Read branch — method is `GET`

1. **Get items** from each list: Projects, Teams, Domains, Statuses, Priorities.
2. Use **Select** to shape each into the field names the app wants. In the Map
   box, toggle to **text/code mode** and paste this (values MUST be quoted, and
   wrap dates in `if(empty(...))` so blank dates don't crash `formatDateTime`):
   ```
   {
     "domain": "@{toLower(item()?['Domain'])}",
     "id": "@{item()?['Title']}",
     "name": "@{item()?['Name']}",
     "description": "@{item()?['Description']}",
     "timelineStart": "@{if(empty(item()?['TimelineStart']),'',formatDateTime(item()?['TimelineStart'],'yyyy-MM-dd'))}",
     "timelineEnd": "@{if(empty(item()?['TimelineEnd']),'',formatDateTime(item()?['TimelineEnd'],'yyyy-MM-dd'))}",
     "status": "@{item()?['Status']}",
     "priority": "@{item()?['Priority']}",
     "owner": "@{item()?['Owner']}",
     "teams": "@{item()?['Teams']}",
     "link": "@{item()?['Link']}",
     "progress": "@{item()?['Progress']}"
   }
   ```
3. **Respond** (HTTP Response action) with status `200`, header
   `Content-Type: application/json`, and body:
   ```json
   {
     "projects":   <Select Projects output>,
     "teams":      <Select Teams output>,
     "domains":    <Select Domains output>,
     "statuses":   <Select Statuses output>,
     "priorities": <Select Priorities output>
   }
   ```

That **flat** shape is all the app needs — it reassembles the nested roadmap
itself (see `normalizeRemotePayload` in `src/services/sheetsApi.js`).

### Write branch — method is `POST`

The body is `{ "action": "...", ... }`. **Switch** on `action`:

| `action` | Fields in body | Flow does |
|---|---|---|
| `add` (default) | team (=domain), id, name, description, timelineStart, timelineEnd, status, priority, owner, teams, link, progress | **Create item** in Projects |
| `update` | same as add (id+team identify the row) | **Get items** (filter `Title eq id` and `Domain eq team`) → **Update item** |
| `delete` | team, id | find item → **Delete item** |
| `updateStatus` | team, id, status | find item → **Update item** (Status) |
| `addTeam` | teamId, teamName, color | **Create item** in Teams |
| `deleteTeam` | teamId | find → **Delete item** in Teams |
| `addDomain` / `deleteDomain` | name / id | Domains list |
| `addStatus` / `deleteStatus` | label, color / id | Statuses list |
| `addPriority` / `deletePriority` | label, color / id | Priorities list |

Each branch ends with a **Response** `200` returning `{ "ok": true }` (or
`{ "ok": false, "error": "..." }` on failure — the app surfaces `error`).

> Tip: build the `add`/`update`/`delete` Projects actions first, confirm the app
> works end-to-end, then add the Teams/Domains/Statuses/Priorities branches.

---

## Step 3 — File uploads (Cookiebot reports)

Two options:

- **Simplest:** team members upload report files **directly into the `Reports`
  document library** in SharePoint, and download from there. No app change needed
  for download — link the library from the Sites tab.
- **Through the app:** add `uploadReport` / `listReports` / `deleteReport` actions
  to the flow that use the **SharePoint "Create file" / "List files"** actions.
  Files POST as base64 from the browser.

(See "Remaining frontend wiring" below — the Sites tab currently stores files in
the local DB; routing it to SharePoint is a small follow-up.)

---

## Step 4 — Auth & security

- The flow URL contains a **SAS signature** (`?sig=…`). Anyone with the full URL
  can call it, so **treat it as a secret** — it's injected at build time via the
  GitHub Actions secret `VITE_SHEETS_API_URL`, not committed.
- For stronger control, add a check at the top of the flow: require a custom
  header (e.g. `x-api-key`) and compare to a value stored in the flow; reject
  otherwise. Put the same key in the app's fetch headers.
- For true per-user SSO, host the frontend on **Azure Static Web Apps** with
  **Entra ID (Azure AD)** auth in front — then only signed-in org users reach the
  app at all.
- **CORS:** if the browser call is blocked, the SharePoint/Power Automate response
  must allow your app's origin. Power Automate request triggers generally return
  permissive CORS, but if you hit a CORS error, front the flow with **Azure API
  Management** or move the API to an **Azure Function** (which lets you set CORS
  explicitly).

---

## Step 5 — Point the app at it

Local test:
```
# .env
VITE_DATA_SOURCE=remote
VITE_SHEETS_API_URL=https://prod-XX.westus.logic.azure.com:443/workflows/.../triggers/manual/paths/invoke?...&sig=...
```
Restart `npm run dev`, hard-refresh. The app now reads/writes SharePoint.

Production build (GitHub Actions): add `VITE_SHEETS_API_URL` (and
`VITE_DATA_SOURCE=remote`) as repository secrets/variables so the deployed build
uses them.

---

## Remaining frontend wiring (one small follow-up)

Today these paths work against **remote** automatically because they already go
through `src/services/sheetsApi.js`:

- ✅ Roadmap **read** (all data)
- ✅ Project **add / edit / delete / status change**
- ✅ Team **add / delete** (via the contract)

These currently call the local IndexedDB **directly** and need a tiny refactor to
also route through `sheetsApi` (so they hit the flow in remote mode):

- ⏳ **Settings** taxonomy CRUD (Domains / Statuses / Priorities, and the Teams
  section in Settings) — `src/components/views/SettingsView.jsx`
- ⏳ **Sites & Cookiebot** uploads/downloads — `src/components/views/SitesView.jsx`

The change is mechanical: replace the direct `db/database` imports with
`sheetsApi` calls that branch local vs remote (the same way projects already do).
Ask and I'll do this wiring.

---

## Step-by-step: getting the URL and (optional) API key

> ⚠️ **Licensing:** the "When an HTTP request is received" trigger is a **premium**
> Power Automate connector. You need a Power Automate **Premium** license (or a
> trial). Check in Power Automate → your profile → it'll prompt if you lack it.
> No premium? Use the Azure Functions option instead (see the options table).

### A. Create the SharePoint site + Lists
1. Go to **https://www.office.com** → **SharePoint** → **Create site** →
   **Team site**. Name it `Roadmap`. Note its URL (e.g.
   `https://YOURORG.sharepoint.com/sites/Roadmap`).
2. On that site: **+ New → List** → blank list, name it `Projects`. Add the
   columns from "Step 1" above. Repeat for `Teams`, `Domains`, `Statuses`,
   `Priorities`. Add a **document library** named `Reports`.

### B. Create the flow and copy the URL  ← this is the URL you want
1. Go to **https://make.powerautomate.com**.
2. Top-right **environment picker** → choose your organization's environment
   (not "(default)" personal, if you have a shared one).
3. Left nav → **+ Create** → **Instant cloud flow**.
4. Name it `Roadmap API`. In the trigger search box type **"When an HTTP request
   is received"** and select it. Click **Create**.
5. (Optional) In the trigger, click **Use sample payload to generate schema** and
   paste an example POST body to auto-build the schema. You can skip this.
6. Open **advanced parameters** on the trigger and set **Method** to blank/`Any`
   (so the one URL accepts both GET and POST).
7. **Add at least one action** (e.g. a temporary "Compose"), because the URL is
   **not generated until the flow is saved** with a trigger + action.
8. Click **Save** (top right).
9. Re-open the **"When an HTTP request is received"** trigger card. The field
   **"HTTP POST URL"** is now filled in. Click the **copy** icon next to it.

That copied string is your endpoint — it looks like:
```
https://prod-12.westus.logic.azure.com:443/workflows/abc123.../triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=LONG_SECRET_SIGNATURE
```
The `sig=...` at the end **is the secret** (the "key"). Anyone with the whole URL
can call the flow, so keep it private (treat the URL itself as the API key).

### C. Connect SharePoint inside the flow
When you add SharePoint actions (Get items / Create item), Power Automate prompts
you to **sign in** and creates a **connection** with your M365 account. That
connection is how the flow authenticates to SharePoint — the browser never sees
it. Pick the site URL from step A and the list from the dropdown.

### D. (Optional) Add your own API key header
The signed URL is already a secret, but for a second layer:
1. Decide a secret string, e.g. `RoadmapKey-9f3c…`.
2. In the flow, right after the trigger add a **Condition**:
   `triggerOutputs()?['headers']?['x-api-key']` **is equal to** `RoadmapKey-9f3c…`.
3. **If no** → add a **Response** action, status `401`, then **Terminate**.
   **If yes** → continue to your read/write logic.
4. Tell me the key and I'll make the app send it as an `x-api-key` header on every
   request (a one-line change in `sheetsApi.js`).

### E. Put the URL in the app
**Local test** — edit `.env`:
```
VITE_DATA_SOURCE=remote
VITE_SHEETS_API_URL=<the HTTP POST URL you copied>
```
Restart `npm run dev` and hard-refresh.

**Production (GitHub Pages build)** — in the GitHub repo:
**Settings → Secrets and variables → Actions → New repository secret**
- `VITE_SHEETS_API_URL` = the URL
- add a variable/secret `VITE_DATA_SOURCE` = `remote`

The deploy workflow injects them at build time (Vite reads `VITE_*` at build).

### F. Quick test (no app needed)
Reads:
```bash
curl "https://prod-12.westus.logic.azure.com:443/workflows/.../invoke?...&sig=..."
```
Writes:
```bash
curl -X POST "https://…&sig=…" \
  -H "Content-Type: application/json" \
  -d '{"action":"add","team":"platform","id":"PLAT-9","name":"Test","description":"x","timelineStart":"2026-01-01","timelineEnd":"2026-03-01","status":"Future","priority":"Low","teams":"core"}'
```
A `200` with your JSON (reads) or `{"ok":true}` (writes) means it works.

---

## Copy-paste flow build (projects-only v1)

This builds the whole API as **one flow** over your single `Community Roadmap`
list. Teams/Domains/Statuses/Priorities are optional later — for now the app uses
default statuses/priorities and derives domains from the projects.

**List columns required** (add via List → Settings → Create column). The built-in
`Title` column is the project **ID**:

| Column | Type |
|---|---|
| Domain | Single line of text |
| Name | Single line of text |
| Description | Multiple lines of text (plain) |
| TimelineStart | Date and time (Date only) |
| TimelineEnd | Date and time (Date only) |
| Status | Single line of text (or Choice) |
| Priority | Single line of text (or Choice) |
| Owner | Single line of text |
| Teams | Single line of text |
| Link | Single line of text *(use text, not Hyperlink, to keep mapping simple)* |
| Progress | Number |

### Trigger: "When an HTTP request is received"
- **Method:** leave blank (accepts GET + POST).
- **Request Body JSON Schema** — paste:
```json
{
  "type": "object",
  "properties": {
    "action": { "type": "string" },
    "team": { "type": "string" },
    "id": { "type": "string" },
    "name": { "type": "string" },
    "description": { "type": "string" },
    "timelineStart": { "type": "string" },
    "timelineEnd": { "type": "string" },
    "status": { "type": "string" },
    "priority": { "type": "string" },
    "owner": { "type": "string" },
    "teams": { "type": "string" },
    "link": { "type": "string" },
    "progress": {}
  }
}
```

### Control: Switch
Add a **Switch** action. Set **On** to this expression (the app sends `action:"add"`
for creates and no body for reads):
```
if(empty(coalesce(triggerBody()?['action'], '')), 'read', toLower(string(triggerBody()?['action'])))
```

> Name actions WITHOUT spaces (e.g. `GetAll`) so the `outputs('GetAll')`
> expressions below resolve. Rename via each action's ⋯ menu → Rename.

---

### Case `read`
1. **SharePoint → Get items**, name it **GetAll**. Site Address = your site;
   List Name = `Community Roadmap`. Under ⋯ → Settings, set **Pagination = On**,
   Threshold `5000`.
2. **Data Operation → Select**, name it **ShapeProjects**.
   - **From** (expression): `outputs('GetAll')?['body/value']`
   - **Map** → switch to text/code mode (the small icon) and paste:
```
{
  "domain": "@{toLower(item()?['Domain'])}",
  "id": "@{item()?['Title']}",
  "name": "@{item()?['Name']}",
  "description": "@{item()?['Description']}",
  "timelineStart": "@{if(empty(item()?['TimelineStart']), '', formatDateTime(item()?['TimelineStart'],'yyyy-MM-dd'))}",
  "timelineEnd": "@{if(empty(item()?['TimelineEnd']), '', formatDateTime(item()?['TimelineEnd'],'yyyy-MM-dd'))}",
  "status": "@{item()?['Status']}",
  "priority": "@{item()?['Priority']}",
  "owner": "@{item()?['Owner']}",
  "teams": "@{item()?['Teams']}",
  "link": "@{item()?['Link']}",
  "progress": "@{item()?['Progress']}"
}
```
3. **Request → Response**. Status `200`; Header `Content-Type: application/json`; Body:
```
{
  "projects": @{body('ShapeProjects')}
}
```

---

### Case `add`
1. **SharePoint → Create item** → list `Community Roadmap`. Set fields (expressions):
   - **Title** = `triggerBody()?['id']`
   - Domain = `toLower(triggerBody()?['team'])`
   - Name = `triggerBody()?['name']`
   - Description = `triggerBody()?['description']`
   - TimelineStart = `triggerBody()?['timelineStart']`
   - TimelineEnd = `triggerBody()?['timelineEnd']`
   - Status = `triggerBody()?['status']`
   - Priority = `triggerBody()?['priority']`
   - Owner = `triggerBody()?['owner']`
   - Teams = `triggerBody()?['teams']`
   - Link = `triggerBody()?['link']`
   - Progress = `triggerBody()?['progress']`
2. **Response** `200`, body `{ "ok": true }`.

---

### Case `update`
1. **Get items**, name **GetForUpdate**. **Filter Query**:
   ```
   Title eq '@{triggerBody()?['id']}' and Domain eq '@{toLower(triggerBody()?['team'])}'
   ```
2. **Update item** → Id (expression): `first(outputs('GetForUpdate')?['body/value'])?['ID']`.
   Set the same fields as `add` (Title can stay = `triggerBody()?['id']`).
3. **Response** `200`, `{ "ok": true }`.

### Case `delete`
1. **Get items**, name **GetForDelete**, same Filter Query as update.
2. **Delete item** → Id: `first(outputs('GetForDelete')?['body/value'])?['ID']`.
3. **Response** `200`, `{ "ok": true }`.

### Case `updatestatus`
1. **Get items**, name **GetForStatus**, same Filter Query.
2. **Update item** → Id: `first(outputs('GetForStatus')?['body/value'])?['ID']`;
   set only **Status** = `triggerBody()?['status']`.
3. **Response** `200`, `{ "ok": true }`.

### Default (Switch default branch)
- **Response** `400`, body `{ "ok": false, "error": "Unknown action" }`.

---

### Save, copy URL, test
1. **Save**. Re-open the trigger → copy **HTTP POST URL**.
2. Test read: `curl "PASTE_URL"` → should return `{"projects":[...]}`.
3. Test add:
   ```bash
   curl -X POST "PASTE_URL" -H "Content-Type: application/json" \
     -d '{"action":"add","team":"platform","id":"PLAT-9","name":"Test","description":"hi","timelineStart":"2026-01-01","timelineEnd":"2026-03-01","status":"Future","priority":"Low","owner":"Me","teams":"core","link":"","progress":0}'
   ```
   → `{"ok":true}`, and the row appears in the SharePoint list.
4. Put the URL in `.env` (`VITE_DATA_SOURCE=remote`, `VITE_SHEETS_API_URL=…`),
   restart `npm run dev`. The app is now backed by SharePoint.

> When you're ready, add Teams/Domains/Statuses/Priorities lists + extra `read`
> "Get items" + Select steps (returning `teams`/`domains`/`statuses`/`priorities`
> arrays in the Response), and Switch cases `addTeam`/`deleteTeam`/`addDomain`/etc.
> Ping me and I'll write those too.

## Data model → List mapping (quick reference)

| App table (Dexie) | SharePoint List |
|---|---|
| `projects` | Projects |
| `teams` | Teams |
| `domains` | Domains |
| `statuses` | Statuses |
| `priorities` | Priorities |
| `reports` (blobs) | Reports (document library) |
