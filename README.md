# Promptify: Your AI usage, quantified.

**Promptify** is a 100% local, privacy-first Chrome Extension that automatically tracks your active time across popular AI conversational platforms (ChatGPT, Claude, Gemini, and Perplexity).

There are no servers, no telemetry, and no accounts required. All data is stored in your browser's local IndexedDB, keeping your usage data entirely in your hands.

---

## Supported Platforms

Currently, the extension automatically tracks active tabs for:

- **ChatGPT** (`chatgpt.com`)
- **Claude** (`claude.ai`)
- **Gemini** (`gemini.google.com`)
- **Perplexity** (`perplexity.ai`)

---

## Local Installation (Unpacked Extension)

Since Promptify is currently in development and not on the Chrome Web Store, you can install it directly from the source code:

1. **Clone or Download the Repository:**
   ```bash
   git clone https://github.com/yourusername/promptify.git
   ```
   Or click **Code > Download ZIP** and extract it to a folder.

2. **Open Chrome Extensions:**
   - In Chrome, navigate to `chrome://extensions/`
   - Alternatively, click the puzzle piece icon in the top right and select "Manage extensions".

3. **Enable Developer Mode:**
   - Toggle the **Developer mode** switch in the top right corner of the Extensions page.

4. **Load Unpacked:**
   - Click the **Load unpacked** button in the top left.
   - Select the folder where you cloned/extracted `promptify` (the folder containing `manifest.json`).

5. **Ready!**
   - The Promptify extension icon will appear in your browser. Pin it to your toolbar for easy access to your stats.

---

## How It Works

Promptify uses a highly optimized state machine running entirely in the browser:

| Component | Responsibility |
|-----------|----------------|
| **Content Scripts** | Injected only on supported AI sites. Detects when the user is actively interacting (mouse moves, clicks, typing) or if the tab is visible. Sends heartbeat events. |
| **Service Worker** | Runs in the background (`src/background.js`). Maintains the state of the active session. If it receives heartbeats, it accumulates time. If the tab is closed, hidden, or idle, it finalizes the session and saves it. |
| **IndexedDB** | The local database (`src/db.js`) where completed sessions are permanently stored. |
| **Analytics Dashboard** | A fully local, Neo-Brutalist dashboard (`pages/dashboard/dashboard.html`) to visualize daily, weekly, and monthly usage. |

---

## Tracking Rules

A session is considered **active** only when:

1. The AI website is the **active browser tab**
2. The browser window is **focused**
3. The page is **visible**
4. The user has **interacted recently** (mouse, keyboard, click, scroll)

**Inactivity timeout:** 5 minutes of no interaction ends the session.

This means idle time is never counted, even if you leave an AI tab open in the background for hours.

---

## Directory Structure

```text
Promptify/
├── manifest.json        # Extension configuration
├── src/                 # Core extension logic
│   ├── background.js    # Service worker (session management)
│   ├── content.js       # Content script (activity detection)
│   ├── analytics.js     # Data aggregation functions
│   └── db.js            # IndexedDB wrapper
├── pages/               # UI Components
│   ├── dashboard/       # Main analytics view
│   └── popup/           # Extension popup view
└── assets/              # Static media (icons, logos)
```

---

## Privacy Policy

**Promptify does not track you.** 

- No data leaves your machine. 
- No analytics tools are used. 
- No external requests are made.

All session durations are stored locally in your browser's IndexedDB. You can export or delete your data at any time from the dashboard footer.

## Screenshots

<img width="1850" height="916" alt="1" src="https://github.com/user-attachments/assets/829686d2-4f68-42c7-bf55-9b0a37cd2592" />
<img width="1852" height="921" alt="2" src="https://github.com/user-attachments/assets/f7b83bbc-3ebc-4c2c-b4b4-35a9fee65399" />
<img width="auto" height="500" alt="3" src="https://github.com/user-attachments/assets/0532e0f0-fb29-4269-bf1c-a9cd931eaac9" />



