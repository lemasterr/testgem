# Download State Machine

This project now routes all video downloads through a single state machine defined in `core/download/downloadFlow.ts`. The flow mirrors the expected user journey and keeps transitions explicit so failures are visible and recoverable.

## States

- **Idle** — placeholder before the loop starts.
- **OpenFirstCard** — click the first draft card to enter the viewer.
- **WaitCardReady** — wait for the card UI to render (all `waitForReadySelectors` must resolve) and settle briefly.
- **StartDownload** — attempt to start a download via the provided selector or the kebab menu fallback.
- **WaitDownloadStart** — poll the download directory until a new file appears (typically a `.crdownload`).
- **WaitFileSaved** — continue polling until a finalized `.mp4` is detected with a fresh mtime.
- **SwipeNext** — move to the next card using the supplied `swipeNext` callback.
- **Done** — exit when the configured maximum downloads is reached or cancellation is requested.

## Loop overview

`runDownloadLoop` receives a Puppeteer `page`, a download limit, download directory, selectors to confirm readiness, a selector for the download trigger, and a `swipeNext` callback. It:

1. Ensures the first card is opened and the right panel is available.
2. For each download:
   - Waits for readiness selectors.
   - Clicks the download trigger (directly or via the kebab menu) and confirms a new file appears.
   - Waits until a completed `.mp4` shows up with a recent timestamp.
   - Invokes `swipeNext` before repeating until the limit is hit or `isCancelled` returns true.

Use the optional `onStateChange` hook to log transitions or feed watchdog heartbeats.
