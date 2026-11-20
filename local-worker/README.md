# marteso-local-worker

A standalone CLI that captures App Store screenshots on your own Mac and uploads them to
Marteso. It is a separate tool from `worker/` (the Marteso cloud/CI worker that clones a repo
via an access token and builds remotely) — this one never clones anything, it runs against
whatever iOS project checkout you already have on disk, and its only output is an upload to
Marteso. The two share no code.

## Requirements

- macOS with Xcode and the iOS Simulator installed (same requirements as building the app
  locally).
- Node.js.
- A Marteso API token for your account (the same token used for the MCP/Claude integration,
  under Settings → Agents in the Marteso app).

## Setup

```bash
npm install
```

## Usage

The tool captures whichever repo your shell's current directory is in (`process.cwd()`), so
`cd` into the iOS app's repo first, then invoke it from there via its absolute path — don't use
`npm run capture --prefix ...` or `cd local-worker && npm run capture`, since both of those
change the working directory to `local-worker/` instead:

```bash
cd /path/to/your-ios-app

MARTESO_API_URL=https://your-marteso-instance \
MARTESO_API_TOKEN=your-api-token \
BUNDLE_ID=com.example.yourapp \
/path/to/local-worker/node_modules/.bin/tsx /path/to/local-worker/src/capture.ts
```

### Environment variables

| Variable             | Required | Description                                                        |
| --------------------- | -------- | ------------------------------------------------------------------ |
| `MARTESO_API_URL`     | yes      | Base URL of your Marteso instance.                                 |
| `MARTESO_API_TOKEN`   | yes      | Your Marteso API token.                                            |
| `BUNDLE_ID`           | yes      | Bundle ID of the app in Marteso to capture screenshots for.        |
| `MAX_CONCURRENCY`     | no       | Simulator instances to run in parallel. Defaults to CPU-core based. |
| `REDELIVER_ONLY`      | no       | Set to `1` to skip capturing and re-upload a previously cached, undelivered result. |

## What it does

1. Fetches the app's config (name, iOS subdirectory, framework) from Marteso using `BUNDLE_ID`.
2. Installs native deps (pods / capacitor sync) if needed, then boots simulators and runs the
   app's UI tests to capture screenshots, same device/language config as the cloud worker uses
   (`config.json` in the repo, if present).
3. Uploads the captured screenshots to Marteso in chunks per locale.
4. Prints a link to the screenshot studio job once the upload finishes.

If the upload fails after a successful capture, the result is cached to
`.marteso-capture-result.json` in the current directory — rerun with `REDELIVER_ONLY=1` to
retry delivery without recapturing.
