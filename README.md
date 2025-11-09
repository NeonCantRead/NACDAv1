# 🎬 NACDA v1

**Neon's Awesome Clip Download Assistant**

A powerful Chrome extension for bulk downloading Twitch clips with intelligent filtering, redundancy removal, and accurate size estimation.

---

## 📋 Table of Contents

- [Features](#-features)
- [Installation](#-installation)
- [Setup Guide](#-setup-guide)
- [Usage](#-usage)
- [How It Works](#-how-it-works)
- [Advanced Features](#-advanced-features)
- [Troubleshooting](#-troubleshooting)
- [Technical Details](#-technical-details)

---

## ✨ Features

- **🔍 Multi-Pass Clip Discovery** - Continuous scanning with staggered API passes to maximize clip discovery
- **🧹 Intelligent Redundancy Filtering** - Removes overlapping and redundant clips based on timeline coverage
- **📊 Accurate Size Estimation** - Predicts download size based on empirical analysis
- **🔐 Encrypted Credential Storage** - Secure local storage with user-defined encryption keys
- **👥 User Filtering** - Whitelist or blacklist clips by who created them
- **⚡ Parallel Downloads** - Rate-limited concurrent downloads with progress tracking
- **💾 Smart Caching** - 5-minute cache to avoid redundant API calls
- **🎯 Timeline Coverage Analysis** - Ensures comprehensive stream coverage without gaps

---

## 🚀 Installation

### Prerequisites

- **Google Chrome** (or Chromium-based browser like Edge, Brave, Opera)
- **Twitch Account** with API access

### Quick Install

1. **Download** or clone this repository
   ```bash
   git clone https://github.com/NeonCantRead/NACDAv1.git
   ```

2. **Open Chrome Extensions**
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top-right)

3. **Load Extension**
   - Click **"Load unpacked"**
   - Select the `NACDAv1` folder

4. **Pin Extension** (optional but recommended)
   - Click the puzzle icon in Chrome toolbar
   - Pin NACDA v1 for quick access

---

## 🔧 Setup Guide

### Step 1: Get Twitch API Credentials

#### 1.1 Create Twitch Application

> **Note**: You only need to create one Twitch application per team. Multiple users can share the same Client ID.

1. Go to [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. Click **"Register Your Application"**
3. Fill in the form:
   - **Name**: `My Clip Downloader` (or any name)
   - **OAuth Redirect URLs**: `https://twitchapps.com/tokengen/`
   - **Category**: `Application Integration`
4. Click **"Create"**
5. Copy your **Client ID** (you'll need this as **App ID**)

#### 1.2 Generate OAuth Token

1. Go to [TwitchApps Token Generator](https://twitchapps.com/tokengen/)
2. Paste your **Client ID** in the field
3. Set the **Scopes** to: `editor:manage:clips`
4. Click **"Connect"**
5. Authorize the application when prompted
6. Copy the generated **Access Token**
   - This is your **OAuth Token**

#### 1.3 Find Your Editor ID

**Method 1: Use Twitch API**
1. Use the [Twitch API reference](https://dev.twitch.tv/docs/api/reference#get-users) with your OAuth token
2. Call `GET https://api.twitch.tv/helix/users` with your credentials
3. Your user ID will be in the response

**Method 2: Third-party tool**
1. Visit [Twitch Insights](https://twitchinsights.net/checkuser)
2. Enter your Twitch username
3. Your User ID will be displayed

### Step 2: Configure NACDA v1

1. **Click the NACDA v1 icon** in your Chrome toolbar

2. **First Time Setup**
   - You'll see a "Enter Decryption Key" screen
   - Create a **secure password** (this encrypts your credentials locally)
   - Click **"Unlock"**
   - On first use, this sets up your encryption

3. **Enter Credentials**
   - Expand the **"Credentials"** section
   - Enter your **App ID** (Client ID from Step 1.1)
   - Enter your **OAuth Token** (from Step 1.2)
   - Enter your **Editor ID** (from Step 1.3)
   - These are automatically saved (encrypted)

4. **Configure Filtering** (Optional)
   - Expand **"Filtering Options"**
   - See [Advanced Features](#-advanced-features) for details

---

## 📖 Usage

### Basic Workflow

1. **Navigate to a Twitch channel**
   ```
   https://www.twitch.tv/channelname
   ```

2. **Open NACDA v1 extension**

3. **Enter Stream Information**
   - **Streamer ID/Username**: Channel name or ID
   - **Start Date**: Beginning of clip range
   - **End Date**: End of clip range

4. **Choose Action**

   **🔍 Scan Range** (Recommended first)
   - Discovers clips without downloading
   - Shows estimated download size
   - Displays clip count and total duration
   - Adjustable scan duration (5-15 seconds)
   
   **📥 Download Range**
   - Discovers, filters, and downloads all clips
   - Applies redundancy filtering
   - Downloads in parallel with progress updates

### Example Use Case

**Scenario**: Download all clips from a 24-hour subathon stream

1. Set **Streamer ID**: `channelname`
2. Set **Start**: `2024-11-01T00:00`
3. Set **End**: `2024-11-02T00:00`
4. Click **"Scan Range"** to see what you'll get
   - Example output: `150 clips • 45m 30s • 189.7 MB`
5. Adjust filtering if needed
6. Click **"Download Range"** to download

---

## 🧠 How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    NACDA v1                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐    ┌──────────────┐               │
│  │  popup.js   │───▶│ background.js│               │
│  │  (UI Logic) │    │ (Service      │               │
│  │             │◀───│  Worker)      │               │
│  └─────────────┘    └──────┬───────┘               │
│                            │                        │
│                            ▼                        │
│                    ┌───────────────┐                │
│                    │  Twitch API   │                │
│                    │  • Helix API  │                │
│                    │  • GQL API    │                │
│                    └───────────────┘                │
└─────────────────────────────────────────────────────┘
```

### Core Components
- Handles all UI interactions
- Manages credential encryption/decryption
- Validates user inputs
- Displays progress and size estimates
- Communicates with background service worker

**Key Features:**
- **Web Crypto API** for AES-GCM encryption
- **Exponential backoff** for failed unlock attempts
- **Input validation** with real-time warnings
- **Auto-save** of all form fields (encrypted)

#### 2. **background.js** - Core Logic
- Orchestrates clip discovery and downloads
- Implements multi-pass fetching algorithm
- Handles redundancy filtering
- Manages parallel downloads with rate limiting

**Key Algorithms:**

**Multi-Pass Discovery**
```javascript
// Runs multiple API passes simultaneously
// Each pass starts with 500ms stagger delay
// Continues for configurable duration (5-15s)
// Deduplicates by clip ID
```

**Redundancy Filter**
```javascript
// For each clip pair:
// 1. Check if temporal overlap exists (vod_offset)
// 2. Calculate coverage percentage
// 3. Remove if coverage > threshold
// 4. Account for acceptable gaps
// 5. Keep longest clips when overlapping
```

**Size Estimation**
```javascript
estimatedSize = totalDuration × 698,665 bytes/second
// Based on empirical analysis of Twitch clip data
```

#### 3. **popup.html/css** - Interface Design
- Clean, modern UI with Twitch purple theme
- Collapsible sections for organization
- Real-time validation feedback
- Responsive status messages
- Custom toggle switches and sliders

---

## 🎛️ Advanced Features

### Filtering Options

#### Account List Filtering

Control which users' clips to include/exclude (based on who created the clip, not the streamer):

**Blacklist Mode** (default)
- Excludes clips created by specified users
- Example: Filter out clips from bot accounts or unwanted users
```
accountList: "nightbot, streamelements, moobot"
listMode: Blacklist
Result: Downloads all clips EXCEPT those created by these users
```

**Whitelist Mode**
- Only includes clips created by specified users
- Example: Only download clips from specific community members
```
accountList: "friend1, friend2, mod1"
listMode: Whitelist
Result: Downloads ONLY clips created by these users
```

#### Redundancy Filtering

**Coverage Threshold** (default: 95%)
- Percentage of clip that must be covered by others to be removed
- Higher = keeps more clips (less aggressive filtering)
- Lower = removes more clips (more aggressive filtering)

Examples:
- `95%`: Conservative - only removes clips that are 95%+ covered (keeps more clips)
- `80%`: Moderate - removes clips that are 80%+ covered
- `50%`: Aggressive - removes clips that are 50%+ covered (filters out more clips)

**Max Acceptable Gap** (default: 0 seconds)
- Maximum gap allowed in timeline coverage
- Affects what counts as "covered" time

Examples:
- `0s`: No gaps allowed - ensures complete timeline
- `5s`: Allows small gaps - removes more clips but can leave holes

**Warning Indicators:**
- 🟡 Max Gap > 5s: May allow timeline holes
- 🟡 Coverage < 80%: May remove useful clips

### Scan Duration

Controls how long multi-pass discovery runs (5-15 seconds):

- **5s**: Fast, good for small date ranges or small channels
- **10s**: Balanced (recommended)
- **15s**: Thorough, best for large date ranges or larger channels

**Why Multiple Passes Matter:**

Twitch's clip discovery API orders clips by view count, which can change in real-time. A clip that gains views during your scan could shift position in the results, potentially causing it to be missed by a single pass. Running multiple delayed passes helps catch clips that move around in the rankings, ensuring more complete discovery.

More passes = potentially more clips discovered, especially for high-traffic channels where view counts change frequently.




### Caching System

**5-minute intelligent cache:**
- Caches clip discovery results
- Validates against search parameters:
  - Channel ID
  - Date range
  - Account list
  - Filtering settings
- Auto-invalidates when parameters change
- Saves API calls on repeated scans

---

##  Troubleshooting

### Common Issues

#### ❌ "Decryption failed"

**Cause**: Wrong decryption key
**Solution**: 
- Re-enter your key carefully
- If forgotten, click "Delete Data" (⚠️ will clear credentials)
- First-time users: this is your setup - choose a secure key

#### ❌ "Failed to fetch clips"

**Possible Causes & Solutions:**

1. **Invalid Credentials**
   - Verify App ID and OAuth token are correct
   - Check for extra spaces or incomplete copies

2. **Expired OAuth Token**
   - Tokens can expire
   - Generate a new token (see Setup Guide)

3. **Invalid Channel**
   - Verify channel name/ID is correct
   - Try using channel ID instead of username

#### ❌ "No clips found"

**Possible Causes:**

1. **Date Range**
   - No clips exist in the specified timeframe
   - Try expanding the date range

2. **Account Filtering**
   - Whitelist may be too restrictive
   - Check list mode and account names

#### ⚠️ Size estimate unavailable

**Cause**: No clips discovered or calculation error
**Solution**:
- Verify date range has clips
- Check channel name is correct
- Try scanning again

#### 📥 Downloads not starting

**Possible Causes:**

1. **Browser Permissions**
   - Check Chrome's download settings
   - Ensure extension has download permission

2. **Disk Space**
   - Verify sufficient free space

#### 🐌 Slow downloads

**Optimization:**

1. **Network**
   - Check internet connection speed
   - Pause other downloads

2. **Parallel Downloads**
   - Extension already uses optimal parallelization
   - Downloads run at ~3 concurrent

---

## 🔬 Technical Details

### Technologies Used

- **Chrome Extension API** (Manifest V3)
  - Service Workers
  - Chrome Storage API
  - Downloads API
  - Runtime Messaging

- **Web Crypto API**
  - AES-GCM encryption
  - PBKDF2 key derivation
  - Random salt generation

- **Twitch Helix API**
  - Clips endpoint
  - User endpoint
  - Video metadata

### Security Features

#### Encryption

All credentials are encrypted using:
```
Algorithm: AES-GCM-256
Key Derivation: PBKDF2 with 100,000 iterations
Salt: 16 bytes random (generated once, stored)
IV: 12 bytes random (unique per encryption)
```

**What's Encrypted:**
- App ID (Client ID)
- OAuth Token
- Editor ID
- Channel ID
- Account List
- Date ranges

**What's NOT Encrypted:**
- Filtering settings (max gap, coverage threshold)
- Scan duration
- Salt (needed for decryption)

#### Privacy

- ✅ All data stored **locally only**
- ✅ No external servers contacted (except Twitch API)
- ✅ Decryption key **never stored** (memory only)
- ✅ Open source - verify yourself

### Performance Optimizations

1. **Parallel API Calls**
   - Staggered multi-pass discovery
   - Concurrent download batches

2. **Efficient Filtering**
   - Fast overlap detection
   - O(N²) with early termination
   - Pre-sorting by duration

3. **Smart Caching**
   - 5-minute result cache
   - Parameter validation
   - Reduces redundant API calls

4. **Progress Tracking**
   - Real-time updates
   - Non-blocking UI
   - Background processing

### API Rate Limits

Twitch API has a rate limit of **100 download URLs requested per minute** for clip downloads.

NACDA handles this by:
- Staggered requests (500ms delay between batches)
- Ensures we stay well under the rate limit
- Request batching for efficiency
- Efficient pagination for clip discovery

### File Naming

Downloaded clips use format:
```
{creation_date}_{clip_title}_{clipper_name}_{clip_SLUG}.mp4

A future update will allow for custom naming formats
```

Example:
```
2025-10-31_Most subtle August_Anomaly plug_NeonVchewbuh_UseCodeAugyForTenPercentOffAtCheckout-QbZ4AoHxiTmaaBMb.mp4
```

### Browser Compatibility

**Compatible with Chromium-based browsers only:**
- ✅ Google Chrome
- ✅ Microsoft Edge
- ✅ Brave Browser

**Not Compatible:**
- ❌ Firefox (different extension API)
- ❌ Safari (different extension API)
- ❌ Any non-Chromium browser

---

## 📄 License

This project is provided as-is for educational and personal use.

**Please Note:**
- Respect Twitch's Terms of Service
- Don't abuse the API (rate limiting exists for a reason)
- Only download clips you have rights to use
- Consider supporting streamers whose content you archive

---

## 🙏 Credits

**Created by**: NeonVchewbuh

**Built with:**
- Twitch Helix API
- Web Crypto API
- Chrome Extensions API

**Special Thanks:**
- Twitch for providing comprehensive API access
- The open-source community for tools and libraries
- Github CoPilot for trying to leak my API keys twice

---

