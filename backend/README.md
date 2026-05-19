# stl viewer backend

Go API between the Svelte frontend and Google Sheets. Google service account
credentials stay on the server; the browser only talks to `/api/*`.

## Setup

1. Create a Google Cloud service account with access to Google Sheets API.
2. Share the spreadsheet with the service account email.
3. Copy `.env.example` to `.env` and set:
   - `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_SERVICE_ACCOUNT_JSON`
   - `GOOGLE_SHEETS_ID`
   - `SHEET_WRITE_TOKEN`
4. Run:

```powershell
go run .
```

## Endpoints

- `GET /healthz`
- `GET /api/pricing`
- `POST /api/orders/fdm`

`POST /api/orders/fdm` requires the `X-Write-Token` header. Keep this endpoint
behind your own auth or call it from a trusted server route in production.
