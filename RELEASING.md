# Releasing + auto-updates (GitHub Releases)

This project uses Tauri v2 and the updater is configured to read a manifest from GitHub Releases.

## 1) Configure the updater URL + public key

Edit `src-tauri/tauri.conf.json`:

- Replace `REPLACE_ME_OWNER/REPLACE_ME_REPO` with your GitHub `owner/repo`.
- Replace `REPLACE_ME_TAURI_PUBLIC_KEY` with your **Tauri updater public key** (see below).

The updater endpoint is expected to be:

`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`

## 2) Generate updater signing keys (once)

On your dev machine:

```bash
npx tauri signer generate
```

This prints a **public key** and stores the **private key** locally. Keep the private key secret.

## 3) Add GitHub Actions secrets

In GitHub repo settings → Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — contents of the private key file (not the path)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — only if your private key is password-protected

The workflow file is `/.github/workflows/release.yml`.

## 4) Make a release

1. Bump the app version in `src-tauri/tauri.conf.json` (field `"version"`).
2. Commit.
3. Create and push a tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions will build and publish a GitHub Release with installers and updater artifacts, including `latest.json`.

## 5) Check updates in the app

Open Settings → **Check Updates**.

If an update is available, it will download, install, and restart the app.

