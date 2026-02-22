# ECHO 易可 — Make Edge Better for Chinese Users

> 🌐 [中文版](README.md)

> ⚠️ **Unofficial & Fan-made**: This is a personal side project, not affiliated with Microsoft or the Edge team. Independently developed and maintained.

**ECHO 易可** is a browser enhancement extension built specifically for Chinese Edge users. From tab management to mouse gestures, from a beautiful New Tab Page to AI-powered search recommendations — it's designed to elevate every aspect of your browsing experience.

This project was built entirely by a **non-technical PM** through AI-assisted programming (Vibe Coding). It's not perfect, but every line of code represents real product thinking and countless rounds of testing.

---

## ✨ Features

### ⚡ Efficiency

#### 🔄 Super Drag

- **Drag text**: Automatically search with Bing
- **Drag links**: Open in a new tab
- Configurable: new tab activates immediately or opens in background
- Minimum drag distance threshold to prevent accidental triggers

#### 🖱️ Mouse Gestures

- **Right-click + Scroll Wheel**: Quickly switch between tabs (left/right)
- Automatically skips browser internal pages (chrome://, edge://, etc.)
- Cross-tab state sync: gesture state transfers seamlessly when switching tabs

#### ⌨️ Keyboard Shortcuts

- **Ctrl+Q**: Boss Key — minimize all browser windows instantly, press again to restore (remembers each window's previous state)
- **Alt+M**: One-key Mute — toggle mute for all audible tabs
- **F2 / F3**: Quick switch to left/right tab

### 🌐 Page Experience

#### 🔠 Fine Zoom

- **Ctrl + Scroll Wheel**: Optimized zoom stepping
  - Below 175%: 5% fine steps
  - Above 175%: 25% large steps
- Floating zoom indicator, auto-hides after 2 seconds

#### 🖼️ Quick Save Image

- **Alt + Click**: One-click save any webpage image to local `ECHO快速保存图片` folder
- Optional auto-categorization by date subfolder
- No "Save As" dialog — downloads directly to the designated path
- 💡 Edge's built-in download flyout cannot be controlled by extensions; you can disable it in Edge Settings → Downloads

### 📋 Tab Management

- **New Tab Position Control**: New tabs open right next to the current tab — no more jumping to the far right
  - "Newest first" and "Sequential order" modes
  - Optional: apply position rules to the `+` button as well
- **Close Tab Activation**: Closing a tab activates the one on the **left** (instead of browser's default right)
- Concurrency-safe: correct ordering even when rapidly opening multiple tabs

### 🎨 Personalization

#### 🖼️ New Tab Page (NTP)

- **Bing Daily Wallpaper**: Auto-fetched HD wallpapers as background
- **Three wallpaper modes**:
  - Daily: auto-rotates each day
  - Collection shuffle: random pick from favorites (stable within same day)
  - Locked: pin a specific wallpaper
- **Wallpaper Gallery**: Browse wallpaper history, one-click favorite/unfavorite
- **3-tier caching**: Memory preload → IndexedDB offline cache → Network fetch — near-instant loading
- **Trending lists**: Multiple categories (trending, novels, movies, etc.)
- **Wallpaper info card**: Auto-reveals on mouse proximity, draggable
- **Low Poly dynamic background**: Triangulated mesh with mouse parallax effect

#### 🔍 Floating Search Box (Ctrl+B)

- In-page Bing search box, available anytime
- **Rainbow spectrum border animation** + focus pulse effect
- Integrated trending list with infinite scroll
- Always-show mode or shortcut-only mode
- Shadow DOM isolation — zero interference with page styles
- Auto zoom compensation at any page zoom level

#### 🤖 AI Related Search (Experimental)

- **Disabled by default** — requires manual opt-in with secondary confirmation
- Automatically extracts page content, generates 4-6 related search keywords via AI
- Smart filtering: auto-skips homepages, search engines, intranet pages, and sensitive domains (.gov/.mil/.edu, etc.)
- Per-site blacklist with undo support
- Shadow DOM floating widget, draggable, non-intrusive

### 🎯 First Run Experience (FRE)

- 4-step onboarding guide on first install
- Auto-detects OS and displays corresponding shortcuts (Win/Mac)

---

## 📦 Installation

### From Source (Developer Mode)

1. Download or clone this repository
2. Open Edge browser, navigate to `edge://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked"
5. Select this project's folder

### From Edge Add-ons Store

> Coming soon.

---

## ⚙️ Settings

Click the ECHO icon in the Edge toolbar to open settings. All features can be toggled independently:

| Feature             | Default       | Description                              |
| ------------------- | ------------- | ---------------------------------------- |
| Super Drag          | ✅ On          | Drag text to search / drag links to open |
| Mouse Gestures      | ✅ On          | Right-click + scroll to switch tabs      |
| Boss Key            | ✅ On          | Ctrl+Q minimize/restore                  |
| One-key Mute        | ✅ On          | Alt+M global mute                        |
| F2/F3 Tab Switch    | ✅ On          | Keyboard tab switching                   |
| Fine Zoom           | ✅ On          | Ctrl+scroll fine zoom                    |
| Quick Save Image    | ✅ On          | Alt+click to save                        |
| New Tab Position    | After current | Or: at end                               |
| Close Tab Activate  | Left tab      | Or: right (browser default)              |
| Floating Search Box | ✅ On          | Ctrl+B toggle                            |
| AI Related Search   | ❌ Off         | Requires manual opt-in                   |

---

## 🏗️ Technical Architecture

```
ECHO/
├── manifest.json           # MV3 manifest
├── background.js           # Service Worker (tab management, messaging, AI proxy, etc.)
├── content.js              # Content script (gestures, drag, zoom)
├── net_rules.json          # Request header modification rules
├── ntp/
│   ├── ntp.html / ntp.js   # New Tab Page (wallpaper system, trending)
│   ├── ntp.css
│   └── wallpaper-data.js   # Bing wallpaper history data
├── search-box/
│   └── search-box.js       # Floating search box
├── related-search/
│   └── related-search.js   # AI related search recommendations
├── common/
│   ├── mouse-gesture.js    # Mouse gesture module
│   ├── super-drag.js       # Super drag module
│   ├── keyboard-enhance.js # Keyboard enhancement module
│   └── lowpoly-bg.js       # Low Poly dynamic background
├── options/
│   ├── options.html / options.js / options.css  # Settings page
├── fre/
│   ├── fre.js              # First Run Experience logic
│   └── fre-step1~4.html    # Onboarding pages
└── PRIVACY_POLICY.md       # Privacy policy
```

- **Manifest V3**: Service Worker architecture
- **Shadow DOM**: Search box and related search use Closed Shadow DOM for complete style isolation
- **IndexedDB**: Wallpaper blob offline caching with 7-day TTL
- **declarativeNetRequest**: Targeted header modifications for CORS resolution

---

## 🔒 Privacy

ECHO strictly follows a **"Local First"** principle:

- All core features run entirely locally — no user data is uploaded
- AI Related Search is experimental, disabled by default, and uses **fully anonymous API calls** (no tokens, no cookies, no user identifiers)
- Automatically skips intranet pages and sensitive domains (.gov/.mil/.edu/.corp/.internal)

📄 Full privacy policy: [PRIVACY_POLICY.md](PRIVACY_POLICY.md)

---

## 📋 Third-Party Services Disclosure

This extension uses the following publicly available third-party services. **None** are official Microsoft/Edge services:

| Service                                      | Purpose                          | Notes            |
| -------------------------------------------- | -------------------------------- | ---------------- |
| [Bing Daily Wallpaper](https://cn.bing.com)  | NTP wallpaper source             | Public API       |
| [Baidu Hot Search](https://top.baidu.com)    | NTP trending lists               | Public API       |
| [Toutiao Hot Board](https://www.toutiao.com) | Search box trending              | Public API       |
| [Pollinations.ai](https://pollinations.ai)   | AI keyword extraction (primary)  | HTTPS, anonymous |
| Ollama Public Test Server                    | AI keyword extraction (fallback) | HTTP, anonymous  |

---

## 🙏 About This Project

This is a personal fan-made project built by a **non-technical PM** through AI-assisted programming (Vibe Coding).

- **NOT** an official Microsoft product
- **NOT** made by the Edge team
- Developed and maintained in a personal capacity

It was born from a power user's passion for improving the Edge browsing experience, and countless late nights of iterating with AI.

If you find it useful, a ⭐ Star would be greatly appreciated. Found a bug? Feel free to open an Issue.

- 🏠 **Repository**: [github.com/echoextension/echo](https://github.com/echoextension/echo)

---

## 📜 License

This project is licensed under [GPL-3.0](LICENSE). You are free to use, modify, and distribute it, but derivative works must be open-sourced under the same license.

---

## 📬 Contact

- 📧 echoextension [at] hotmail [dot] com
