<div align="center">

<img src="assets/icon.png" width="112" alt="Pi Muse Mobile">

# Pi Muse Mobile

[English](README.md) | [简体中文](README.zh-CN.md)

**The official React Native client for [Pi Muse](https://github.com/yaotutu/pi-muse), a self-hosted personal agent built on [pi](https://github.com/earendil-works/pi)**

Keep conversations, isolated spaces, approvals, recurring jobs, web monitors, goals, memory, and workspace files within reach—without moving your model credentials from your own server.

[Features](#features) · [Quick start](#quick-start) · [Develop from source](#develop-from-source) · [Security](#security-and-data-handling) · [Documentation](#documentation)

[![Pi Muse server](https://img.shields.io/badge/Server-pi--muse-2563EB?style=flat-square)](https://github.com/yaotutu/pi-muse)
[![Android releases](https://img.shields.io/badge/Android-APK-3DDC84?style=flat-square)](https://github.com/yaotutu/pi-muse-mobile/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)

<br/>

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/showcase.png" width="98%" alt="Pi Muse Mobile product overview">
</p>

</div>

---

Pi Muse Mobile is a native mobile interface, not a standalone assistant. It connects to a Pi Muse server over the product's public HTTP/SSE API; the server owns agent execution, model access, spaces, files, schedules, approvals, and other persistent state.

Prebuilt downloads are currently available for Android. iOS is a source-development target, and the Expo web output is a development preview rather than the official Pi Muse web client.

## Features

### Chat and isolated spaces

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/chat-preview.png" width="88%" alt="Chat with Markdown, tool cards, and the space sidebar">
</p>

- **Streaming chat.** Messages run through the server's AG-UI SSE stream and are consumed natively by the client. The chat stream is separate from the shared notification stream used for runtime status.
- **Persistent message feedback.** Long-press a saved user or assistant message bubble for a nearby reaction pill and a compact Comments/Copy menu. A small badge on the bubble edge shows an existing Like/Dislike or comment count; messages without feedback have no badge. Reactions are mutually exclusive and undoable, while comments open in a separate view for adding, editing, and deleting. Edited and deleted comment text remains in the server ledger. Feedback never starts a model run or writes model preferences. Incomplete streaming messages are not eligible, and resetting or deleting a conversation clears its feedback.
- **Purposeful Markdown rendering.** Assistant messages render headings, emphasis, lists, quotations, tables, and copyable code blocks with native React Native components. Markdown images are not loaded, HTML is shown as literal text, and message/search links are restricted to credential-free HTTP(S).
- **Transparent tool cards.** Tool activity displays the projections returned by the server. The client does not infer hidden details or mark a result as saved or approved merely because a tool returned.
- **Isolated spaces.** Create, search, and switch contexts such as Work, Life, or Study. Each space has its own conversation, instructions, skills, and private files.
- **Useful attachments.** A message can contain up to four attachments: PNG, JPEG, GIF, or WebP images and recognized UTF-8 text/code files. The total attachment limit is 8 MiB, and text attachments together may contain at most 100,000 bytes. PDF, Office, archives, and other binary formats are not supported. Image understanding requires the server's configured model to support vision; the client does not silently switch models.

### Jobs, activity, and web monitoring

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/tasks-preview.png" width="88%" alt="Activity history, scheduled jobs, and web monitors">
</p>

- **Model-registered activity history.** Browse and filter registered activities, inspect status and steps, and refresh manually. Only activities reported by the server are shown; the client does not invent progress data.
- **Scheduled jobs.** Create one-time or daily jobs through chat, then manage their content, schedule, and lifecycle in the Tasks screen. Pause, resume, cancel, retry failed work, and delete with explicit confirmation. Job controls manage schedule state; they are not a precise Stop button for an already-running agent run.
- **Web monitors.** Create monitors through chat and use the Tasks screen to filter, refresh, pause, resume, stop, or delete them. Pi Muse Mobile shows cumulative checks and the most recent check, notification, or fetch error; the server does not expose a per-check history.
- **Optional real-browser takeover.** The Real Browser setting opens a configured noVNC URL in the device's system browser. The mobile app neither embeds nor deploys that browser; deploy the optional browser container on the Pi Muse server side.

### Long-term goals and milestones

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/goals-preview.png" width="52%" alt="Long-term goals and milestone tracking">
</p>

- **Turn plans into checkpoints.** Create goals, organize milestones, and track progress such as `1 / 3`.
- **Maintain progress deliberately.** Change goal status and check milestones yourself; the app does not infer completion from chat text.
- **Keep the view focused.** Filter by state and sort by creation or update time before confirming irreversible deletions.

### Session panel, approvals, and workspace files

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/session-preview.png" width="88%" alt="Session panel with activity, approvals, workspace rules, and history">
</p>

- **One full-screen session center.** Tap the session information area at the top of the chat to open the current session panel. Its Activity, Approvals, Workspace, and History tabs switch in place while the chat remains mounted behind it.
- **Current execution and activity history.** Follow the current run, tool work, model-registered activities, progress, results, and related steps. Activity is not hidden model reasoning and is not represented as an archive of every chat run.
- **Human-in-the-loop approvals.** Agent-initiated file writes and edits require full before/after review and explicit confirmation. A stale approval cannot overwrite content that changed after the approval was created.
- **Workspace file management.** Browse current-space private files and all-space shared files, read complete text, preview supported images, and download files to a chosen Android directory without overwriting same-name files. Manual text saves require complete-content review and confirmation.

### Settings, memory, Dream, and themes

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/settings-preview.png" width="52%" alt="Settings, profiles, memory, Dream, and themes">
</p>

- **Server connection management.** Save one reachable Pi Muse address, authenticate with the server AccessKey, and keep the resulting session token on the device. The plaintext AccessKey is not persisted by the client.
- **Assistant and user profiles.** Edit the assistant name and tone plus global SOUL and USER profiles. Profile changes take effect on later conversations.
- **Global long-term memory.** Search, create, edit, and delete memories shared across spaces. Refreshes happen when the page opens or returns to the foreground, after successful writes, or manually.
- **Dream memory maintenance.** Inspect Dream's global and per-space status, review pending suggestions, adjust prompts and cycles, trigger maintenance, and explicitly apply or dismiss suggestions.
- **Three complete themes.** Choose Classic Blue, Morning Light, or Midnight Black. The selection is local, survives restarts, and never encodes server credentials.
- **Android app updates.** The packaged Android app checks public GitHub releases, downloads stable APK assets, and hands installation to the Android system installer. If a check fails, including GitHub rate limiting, the update panel provides the official APK URL and a manual download button. Updates are not Expo OTA and are unavailable in Expo Go, web, or iOS builds.
- **Current boundaries.** Voice input/transcription and lock-screen push notifications are not implemented. The client uses foreground SSE reconnection rather than claiming always-on background delivery.

## Quick start

### 1. Deploy Pi Muse first

Pi Muse Mobile requires a reachable Pi Muse server and cannot store your model provider key.

Follow the [Pi Muse server quick start](https://github.com/yaotutu/pi-muse#quick-start) to deploy the server, configure its AccessKey, and connect an OpenAI-compatible model. Its runtime `/docs` and `/openapi.json` pages document the HTTP and SSE contracts. The same public API also allows terminals and other platforms to build their own clients; those clients are not part of this repository.

### 2. Install the Android app

1. Download the latest stable `app-release.apk` from [Pi Muse Mobile Releases](https://github.com/yaotutu/pi-muse-mobile/releases/latest).
2. Install and open it on an Android device or emulator. Android may require you to approve installation from that source.
3. Open **Settings -> Server Connection**.
4. Enter an HTTP address reachable from the device, such as `http://192.168.1.100:17890` or `http://your-server.example:17890`. No domain, certificate, or HTTPS reverse proxy is required.
5. Enter the `server.accessKey` configured on your server.
6. Tap **Test Connection**, then **Connect to Server** to save the verified connection.

The server exchanges the AccessKey for a session token. The mobile client stores that token and the server address; it does not persist the plaintext AccessKey or any model API key.

HTTP is supported directly. It sends login credentials, tokens, and conversation content without transport encryption, so prefer a trusted network. HTTPS or a secure private network is optional protection for remote access, not a connection requirement.

## Develop from source

The app is built with Expo 57, React Native 0.86, and TypeScript. For a workspace that develops the mobile client and the Node.js-based Pi Muse server together, use Node.js 24 or newer. The mobile package itself does not declare a lower supported minimum.

```sh
git clone https://github.com/yaotutu/pi-muse-mobile.git
cd pi-muse-mobile
npm ci
npm start
```

### Command guide

| Command | Purpose |
| --- | --- |
| `npm ci` | Install dependencies reproducibly from the lockfile. |
| `npm start` | Start the Expo/Metro development server without launching a specific platform. |
| `npm run android` | Start Expo and open the Android app on a connected device or emulator. |
| `npm run ios` | Start Expo and open the iOS simulator when the required macOS and Xcode toolchain is available. |
| `npm run web` | Start the Expo web development preview on port 8082. |
| `npm run lint` | Run the Expo/ESLint checks. |
| `npm run typecheck` | Run TypeScript with `--noEmit`. |
| `npm test` | Run local Node protocol, state, and contract regression tests. |

Android source development uses the Android SDK and a connected emulator or device. iOS is intended for source development and has no prebuilt package or App Store release in this repository. The web target is useful for quick development checks, not a standalone web product.

### Development quality gates

Before submitting a code change, run:

```sh
npm run lint
npm run typecheck
npm test
```

These are local development gates. `npm test` uses local protocol and state fixtures; it is not a substitute for testing against a real Pi Muse server, a real external model, and the relevant native Android flow. Functional acceptance requirements are described in [AGENTS.md](AGENTS.md).

## Security and data handling

- **Credentials stay split.** Model provider keys and the server AccessKey live in the server deployment. The mobile app sends the AccessKey only for authentication and retains the returned session token, not the plaintext key.
- **Changing servers is explicit.** Replacing the server connection clears the local business data and old credentials for the previous server; it does not delete data stored on that server.
- **Cautious links and projections.** Message and search links are limited to credential-free HTTP(S), Markdown images are not fetched, and tool cards display server-provided projections without inventing hidden state.
- **Approved file mutations.** Pi Muse's server policy provides no shell tool. Agent-initiated file writes and edits are workspace-scoped and require full human diff approval.
- **Self-hosting is not offline AI.** The configured model provider receives the prompts and context needed for a task. Protect server configuration, backups, and any remotely exposed endpoint accordingly.

## Architecture notes

- Four main tabs—Chat, Tasks, Goals, and Settings—are switched with an in-app state machine; the project does not use React Navigation or Expo Router.
- The chat stream uses AG-UI SSE through `expo/fetch`, with custom framing and aggregation implemented in the client.
- Runtime status, approvals, activities, and job invalidation share the server's notification SSE. Spaces, files, memory, goals, jobs, monitors, profiles, and Dream use documented REST endpoints.
- Business state is kept in focused providers and stores around React context. The UI renders native React Native components rather than embedding a web app.
- The source is purpose-written for this client; it is not a CopilotKit SDK wrapper.

## Documentation

- [Pi Muse server](https://github.com/yaotutu/pi-muse) — deployment, configuration, architecture, and API documentation
- [Project handoff](docs/HANDOFF.md) — implementation scope, current status, and historical acceptance notes
- [Theme maintenance](docs/themes.md) — theme registry, tokens, and verification guidance
- [Engineering guidelines](AGENTS.md) — development boundaries, protocol rules, and release policy
- [Release downloads](https://github.com/yaotutu/pi-muse-mobile/releases) — public Android APK assets

## License

Released under the [MIT License](LICENSE).
