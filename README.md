# KUCCPS Cluster React

React (Vite) frontend with:
- Local cluster-point calculation engine.
- Firebase Cloud Functions integration for Daraja payment and email endpoints.
- Firebase Realtime Database for course catalog and session storage.

## Run frontend

```bash
npm install
npm run dev
```

## Build frontend

```bash
npm run build
```

## Run Firebase Functions (Daraja + Email)

```bash
cd functions
npm install
firebase login
firebase deploy --only functions
```

## Environment setup

1. Copy `.env.example` to `.env`.
2. Set backend endpoint variables (Firebase Functions first, Django optional fallback):
   - `VITE_FIREBASE_FUNCTIONS_BASE_URL` (example: `https://us-central1-<project-id>.cloudfunctions.net`)
   - Optional fallback: `VITE_DJANGO_API_BASE_URL`, `VITE_DJANGO_DARAJA_URL`, `VITE_DJANGO_EMAIL_URL`
3. Set Firebase Realtime Database config:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_DATABASE_URL`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_REALTIME_COURSES_PATH` (default `courses`)
4. Set admin/auth settings:
   - `VITE_REALTIME_ADMINS_PATH` (default `admins`)
   - `VITE_SUPER_ADMIN_EMAIL` (first super admin bootstrap email)
5. Set Cloud Functions secrets in `functions/.env`:
   - `MPESA_*` variables for Daraja STK push
   - `EMAIL_HOST_*` and `EMAIL_FROM` for email delivery
5. In Firebase Console:
   - Enable Authentication `Email/Password` provider.
   - Ensure Realtime Database rules allow authenticated admins to read/write `admins`, `courses`, and required session paths.

## Project structure

```text
public/
src/
  components/
    admin/
    common/
    layout/
    results/
  config/
  hooks/
  lib/
  pages/
  utils/
```

## Notes

- App has been refactored for separation of concerns:
  - pages handle screen-level behavior
  - components handle reusable UI
  - hooks hold reusable stateful logic
  - utils/config keep pure helpers and constants
- Course options are loaded from Firebase Realtime Database.
- Admin login now uses Firebase Authentication (Email/Password).
