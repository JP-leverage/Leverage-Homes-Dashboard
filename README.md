# Leverage Homes — KPI Dashboard

Real-time sales KPI dashboard. Data flows Salesforce → Coefficient → Google Sheets →
Google Sheets API (public key) → this app. Runs on sample data until an API key is set.

## 1. Google API key
1. console.cloud.google.com → create a project (or use one).
2. APIs & Services → Library → enable **Google Sheets API**.
3. APIs & Services → Credentials → Create credentials → **API key**.
4. Restrict the key: API restrictions → Google Sheets API only; Application
   restrictions → HTTP referrers → add your site URL(s).

## 2. Share the 6 workbooks
For each workbook (Opportunities, Pipeline, Activities, Marketing, Tasks, Context):
Share → General access → **Anyone with the link → Viewer**.

## 3. Run locally
```bash
npm install
cp .env.example .env      # then paste your key into .env
npm run dev               # http://localhost:5173
```

## 4. Deploy (GitHub Pages)
1. Push this folder to a GitHub repo named `leverage-homes-dashboard`
   (or edit `base` in vite.config.js to match your repo name).
2. Repo → Settings → Secrets and variables → Actions → New secret:
   `VITE_SHEETS_API_KEY` = your key.
3. Repo → Settings → Pages → Source → **GitHub Actions**.
4. Push to `main`; the included workflow builds and publishes automatically.

> The key is a public client-side key by design — the restrictions in step 1
> are what protect it. Rotate it anytime by updating the secret and .env.

## Adding things later
- **A KPI**: add one entry to `KPIS` in `src/LeverageHomesDashboard.jsx`.
- **A workbook / rep tab**: rep tabs auto-discover. A new workbook = one entry
  in `WORKBOOKS` + a `DATASETS` entry with its header signature.
- **Targets**: fill the Targets tab template; the app auto-detects it.
