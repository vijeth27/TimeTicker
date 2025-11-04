# Task Ticker — Notion Pomodoro

Dark theme, no branding. Tracks your Notion Tasks database (Pomodorified==Yes and Status in Not Started/In Progress). On completing a work session, increments **Finished** by +1 for the selected task.

## Quick Start (Local)
```bash
npm i
npm run dev
```
Open http://localhost:5173

## Deploy to Vercel
1. Push this folder to a new GitHub repo.
2. Go to https://vercel.com/new → Import the repo.
3. Framework preset: **Vite** (auto-detected). No special env vars needed.
4. Deploy. Your app URL (e.g., https://task-ticker.vercel.app) can be embedded in Notion using **/embed**.

### Notion Setup
- Create an internal integration at https://www.notion.com/my-integrations and copy the **secret**.
- Share your **Tasks** database with that integration (Full access).
- Property names must match: **Name** (Title), **Status** (Status), **Planned** (Number), **Finished** (Number), **Pomodorified** (Status or Select).
- In the app, paste the **secret** and **database ID**, then click **Load tasks**.

### Notes
- Tailwind is included via CDN for simplicity. For production hardening, you can add a Tailwind build step.
- The app stores your secret locally in the browser's localStorage and uses it only client-side to talk to Notion's API.
- Auto-flow: Work → Short break → Work (long break is manual).