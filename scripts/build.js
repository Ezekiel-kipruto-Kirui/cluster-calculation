const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const args = new Set(process.argv.slice(2).map((arg) => String(arg || "").trim().toLowerCase()));
const hasArg = (...flags) => flags.some((flag) => args.has(flag));

const normalizeFlag = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
};

const shouldSkipBuild = () => normalizeFlag(process.env.SKIP_BUILD) || hasArg("--skip-build");
const shouldSkipFrontendBuild = () =>
  normalizeFlag(process.env.SKIP_FRONTEND_BUILD || process.env.SKIP_FRONTEND) ||
  hasArg("--skip-frontend", "--skip-frontend-build", "--no-frontend");

if (shouldSkipBuild()) {
  console.log("SKIP_BUILD=true -> skipping build steps.");
  process.exit(0);
}

const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "frontend");
const frontendExists = fs.existsSync(frontendDir);

const binExists = (baseDir, binName) => {
  const binDir = path.join(baseDir, "node_modules", ".bin");
  const candidates =
    process.platform === "win32" ? [`${binName}.cmd`, `${binName}.ps1`, binName] : [binName];
  return candidates.some((candidate) => fs.existsSync(path.join(binDir, candidate)));
};

const ensureDevDeps = (label, dir, binName) => {
  if (binExists(dir, binName)) return;
  console.log(`${label} deps missing -> running npm ci --include=dev`);
  execSync("npm ci --include=dev", { stdio: "inherit", cwd: dir });
};

ensureDevDeps("Backend", rootDir, "tsc");

const skipFrontendBuild = shouldSkipFrontendBuild();
if (!frontendExists) {
  console.log("Frontend directory not found -> skipping frontend build.");
} else if (skipFrontendBuild) {
  console.log("SKIP_FRONTEND_BUILD=true -> skipping frontend build.");
} else {
  ensureDevDeps("Frontend", frontendDir, "vite");
  execSync("npm run build:frontend", { stdio: "inherit", cwd: rootDir });
}

execSync("npm run build:backend", { stdio: "inherit", cwd: rootDir });
