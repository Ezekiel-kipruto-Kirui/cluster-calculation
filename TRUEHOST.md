# Truehost Deployment (No Frontend Build on Host)

This guide assumes you build everything locally and Truehost only runs the compiled backend.

## Local build (your machine)

```bash
npm install
npm --prefix frontend install
npm run build:full
```

Confirm these files exist:
- `dist/index.js`
- `dist/frontend/dist/index.html`

Commit and push the generated `dist/` folder.

## Truehost setup

1. Create a Node.js application in Truehost/cPanel.
2. Set Node.js version to `20`.
3. Set **Application root** to the cloned repo folder.
4. Set **Application startup file** to `dist/index.js`.
5. Open the terminal and run:

```bash
npm install
```

6. Configure environment variables (minimum):
   - `NODE_ENV=production`
   - `PORT=5001` (or the port Truehost expects)
   - `MPESA_*`, `FIREBASE_*`, `SUPER_ADMIN_EMAIL`, `CORS_ORIGIN` as needed

7. Restart the Node.js application.

## Notes

- If Truehost forces a build step, set `SKIP_BUILD=true` or set the build command to `npm run build:truehost`.
- The backend will serve the built frontend from `dist/frontend/dist` when present.
