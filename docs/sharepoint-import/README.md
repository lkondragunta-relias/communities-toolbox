# SharePoint import files

Five ready-to-import Excel files. Importing each one **auto-creates a list with
its columns and data** — no manual column setup.

| File | Becomes the list | Columns |
|---|---|---|
| `Community Roadmap - Projects.xlsx` | Projects (the main data) | Title (=project id), Domain, Name, Description, TimelineStart, TimelineEnd, Status, Priority, Owner, Teams, Link, Progress |
| `Community Roadmap - Teams.xlsx` | Teams | Title (=team id), Label, Color |
| `Community Roadmap - Domains.xlsx` | Domains | Title (=domain id), Name |
| `Community Roadmap - Statuses.xlsx` | Statuses | Title (=label), Color, SortOrder |
| `Community Roadmap - Priorities.xlsx` | Priorities | Title (=label), Color, SortOrder |

## How to import (per file)

On your site **ReleaseReadiness-Communities**:

1. **+ New → List → From Excel** (or **Import spreadsheet**).
2. Upload one file. SharePoint shows a preview of the columns.
3. Confirm the table/range, name the list (e.g. **Community Roadmap - Teams**),
   **Create**.
4. Repeat for all five files.

> **Grouping:** SharePoint has no "folder of lists" — the **site** is the
> container. Prefixing every list with `Community Roadmap - ` keeps them sorted
> together in **Site contents**.

## After import — fix column types (important)

SharePoint guesses types from the data, so correct these once per list
(List → **Settings / Edit columns**):

- **Projects → TimelineStart, TimelineEnd** → change to **Date and time → Date only**.
- **Projects → Progress** and **Statuses/Priorities → SortOrder** → **Number**.
- **Projects → Status / Priority** can stay text, or convert to **Choice** using
  the values from the Statuses/Priorities lists.
- The **Title** column is the row key: it holds the project id / team id / domain
  id / status label / priority label (do not rename it).

## Notes

- **Teams** column in Projects is **comma-separated team ids** (e.g. `core,data`),
  matching the Title values in the Teams list.
- **Domain** in Projects is the lowercase domain id (e.g. `platform`), matching a
  Title in the Domains list.
- Colors are hex strings (e.g. `#8b5cf6`); they drive the roadmap bar / badges.
- These rows are the same seed data the app ships with locally, so the app will
  look familiar once connected.

Next: build the Power Automate flow that reads/writes these lists — see
`../PRODUCTION-SHAREPOINT.md`.
