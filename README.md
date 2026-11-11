<div align="center">

<img src="assets/icon.png" width="112" alt="Pi Muse Mobile">

# Pi Muse Mobile

[English](README.md) | [简体中文](README.zh-CN.md)

**Your [Pi Muse](https://github.com/yaotutu/pi-muse) assistant, in a native mobile app**

Start a conversation, read something worth discussing, and keep plans moving—while model access and your assistant's data stay on your own server.

**[Download Android APK](https://github.com/yaotutu/pi-muse-mobile/releases/latest/download/app-release.apk)** · [Release notes](https://github.com/yaotutu/pi-muse-mobile/releases/latest) · [Deploy the server](https://github.com/yaotutu/pi-muse#quick-start)

[The experience](#the-experience) · [Install and connect](#install-and-connect) · [Develop from source](#develop-from-source) · [Safety and limits](#safety-and-limits)

<img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/showcase.png" width="98%" alt="Pi Muse Android app: main chat, news, and settings">

</div>

Screenshots use demo data; the companion pack shown is a replaceable example. This README describes current source capabilities. Check the selected release's notes and assets rather than assuming the latest published APK includes every feature shown here.

Individual screens: [Main chat](https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/screenshots/chat.png) · [News](https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/screenshots/news.png) · [Settings](https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/screenshots/settings.png)

## The experience

Pi Muse Mobile is the official Expo / React Native client for a self-hosted, single-user AI assistant built on [pi](https://github.com/earendil-works/pi). It is a native interface, not an embedded web chat or a standalone model runner. A reachable Pi Muse server is required.

### Three tabs, one place to talk

- **Messages** opens the permanent `main` chat directly, with no conversation picker. Stream replies, read native Markdown and copyable code, attach images or text, and leave feedback on saved messages. Switching tabs preserves the main chat and its draft. The server has topic-session foundations, but topic-session UI is not currently exposed in the app.
- **News** is a global RSS reading and recommendation feed, with article details, Like, Dislike, and Save. **Discuss** adds an editable, explicitly untrusted article citation to the existing main draft; it never sends automatically. Return to the article when you are done.
- **Settings** keeps controls out of the chat log: assistant identity, instructions and skills, memory and Dream, goals, scheduled tasks, web monitors, workspace files, activity and approvals, connection, appearance, and updates.

### A companion that shows what is happening

A transparent character and compact status label float together over chat without a large backing card. Eight poses and the status label show idle, thinking, responding, working, awaiting approval, success, error, and stopped states. Light, finite animations reinforce those states; these are pose images, not videos, and reduced-motion settings are respected. Tap the character or status to expand main-chat actions, execution, approvals, and history around that same character. Closing reverses the transition without recreating the chat.

The built-in penguin is always available as a fallback. In **Settings → Companion**, select a complete custom pack installed on your server. The app downloads all eight state images before switching, and a complete same-server cache remains usable offline. Missing or incomplete packs fall back to the penguin with a notice. Changing servers clears the old pack cache and selection; choosing a character does not create another assistant or restart the chat stream.

<img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/screenshots/companions.png" width="360" alt="Choosing a replaceable assistant companion pack">

Choose **Classic Blue, Morning Light, or Midnight Black** for the rest of the interface. Theme and companion preferences are local to the device.

### Review work, not just replies

- **File approvals.** Review the full before/after content for each assistant `write` or `edit`, then explicitly approve that exact file version. An expired, cancelled, rejected, or changed-file approval cannot commit. The model has no shell tool; all sessions share one flat workspace.
- **Tasks and goals.** Create one-time or daily tasks through chat, then manage them in Settings. Public-page monitors have a minimum five-minute interval. Track goals and check off milestones deliberately; the app does not infer completion from chat text.
- **Memory and working style.** Edit assistant and user profiles, main-chat instructions and skills, and long-term memories. Inspect optional Dream maintenance and explicitly apply or dismiss its suggestions.
- **The same real browser.** When the server's browser deployment is available, open its graphical Chrome through the app's WebView. The assistant and human viewer share that browser and login state. Chrome/noVNC availability and proxy limits depend on [server configuration](https://github.com/yaotutu/pi-muse/blob/main/docs/manual/en/browser-docker.md).

## Install and connect

### Android

1. [Deploy Pi Muse](https://github.com/yaotutu/pi-muse#quick-start) with a strong server AccessKey and a model endpoint supported by its configured pi provider. The app does not need your model API key.
2. [Download the latest stable `app-release.apk`](https://github.com/yaotutu/pi-muse-mobile/releases/latest/download/app-release.apk), install it, and open the app. Android may ask you to allow installation from that source.
3. Open **Server Connection** on the disconnected screen, or **Settings → Server Connection** when connected.
4. Enter the server's base address reachable from the phone, such as `http://192.168.1.100:12330`, and the configured `server.accessKey`. Do not append `/api` or `/docs`; on a physical phone, `localhost` means the phone itself.
5. Tap **Save**. The app verifies the address and AccessKey before saving. **Test Connection** is optional and does not save anything.
6. Open **Messages** and send your first message. The model runs on the server; no client rebuild is needed to connect to your own deployment.

HTTP is supported without a domain, certificate, or reverse proxy, but does not encrypt credentials, tokens, or conversation content. Prefer a trusted network and protect remote access appropriately. See the shared [Getting Started guide](https://github.com/yaotutu/pi-muse/blob/main/docs/manual/en/getting-started.md) for network setup and recovery.

The packaged Android app can check stable GitHub releases and download APK updates; installation still requires Android's system confirmation. It is not an Expo OTA update path.

### iOS and web

An `app-release-unsigned.ipa` is useful only when actually attached to the selected release and you have your own valid iOS signing credentials. It **cannot be installed directly**: re-sign it yourself before installation. This repository does not provide App Store or TestFlight distribution.

iOS is also a source-development target. Expo Web is a development preview, not the primary Pi Muse client or a replacement for native Android testing.

## Safety and limits

- **Credentials stay separated.** Model keys remain on the server. The app exchanges the server AccessKey for a Session Token and persists only the server address and token, not the plaintext AccessKey.
- **Changing servers needs confirmation.** After successful verification, switching clears the previous connection's local business caches, credentials, and companion selection. It does not delete anything on the old server; the local theme is retained.
- **Self-hosting is not offline AI.** The configured external provider receives the prompts, attachments, and context needed for a task. Protect the server's plaintext instance data and backups.
- **Permissions are not cosmetic.** Instructions and skills cannot bypass version-bound file approvals or expand the server's file and network boundaries. Article content is untrusted; message links are limited to credential-free HTTP(S), and Markdown images are not fetched.
- **Android SMS is optional and off by default.** It needs system permission and a live app process to receive SMS. Important processed results appear in main as notifications; they do not start an extra main-chat model turn. This is not an always-on background service.
- **Delivery has limits.** The app reconnects SSE in the foreground; voice input/transcription and lock-screen push notifications are not implemented. Scheduled work needs the server online, and missed one-time tasks are not replayed after downtime.
- **Attachments depend on the model.** Supported images and UTF-8 text/code can be attached; PDF, Office, and archive files are not supported. Image understanding needs a vision-capable server model—there is no automatic model switch.

## Develop from source

Use Node.js **24.x, at least 24.3.0**, when developing alongside the server, plus npm. The app uses Expo, React Native, and TypeScript; exact dependency versions are in `package.json` and `package-lock.json`.

```sh
git clone https://github.com/yaotutu/pi-muse-mobile.git
cd pi-muse-mobile
npm ci
npm run android
```

Android development needs the Android SDK and a connected device or emulator. `npm start` starts Metro without choosing a platform; `npm run ios` needs macOS and Xcode; `npm run web` starts the development preview on port `8082`.

For code changes, run:

```sh
npm run lint
npm run typecheck
npm test
```

These are local checks, including protocol and state fixtures—not proof of real-model or native-device acceptance. See the engineering guides for those requirements. Native directories are generated by Expo CNG; building and signing release artifacts follow the [release guide](docs/android-release-guide.md).

### Where to look next

- [Shared user manual](https://github.com/yaotutu/pi-muse/blob/main/docs/manual/en/index.md) — daily use, deployment, and configuration
- [Mobile development guide](docs/mobile-development-guide.md) — navigation, stores, and HTTP/SSE integration
- [Theme maintenance](docs/themes.md) · [Engineering rules](AGENTS.md)
- The running server's `/docs` and `/openapi.json` — current API contracts; chat AG-UI SSE and the shared `/api/events` notification stream are separate

## License

Released under the [MIT License](LICENSE).
