# Agent-Browser Edge CDP Setup Guide

Connect Claude to your authenticated Edge browser via Chrome DevTools Protocol (CDP). This lets Claude browse sites protected by Microsoft SSO (like agent-arch.example.com) without automating the login flow.

## Why CDP?

Standard Playwright launches a fresh browser profile with no session cookies. Microsoft SSO uses popup-based authentication that Playwright cannot handle -- Cross-Origin-Opener-Policy (COOP) blocks `window.closed` calls, causing the auth flow to hang forever. CDP sidesteps this entirely by connecting to your real Edge browser where you're already signed in.

## Prerequisites

- **agent-browser** installed globally: `npm install -g agent-browser`
- **Edge** installed at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- **Node.js** available on PATH
- **User is signed in** to the target site (e.g., agent-arch.example.com) in Edge

## Step-by-Step Setup

### 1. Kill all Edge processes

Edge ignores `--remote-debugging-port` if any instance is already running. You must kill everything first.

```powershell
Stop-Process -Name msedge -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
```

### 2. Launch Edge with CDP enabled

```powershell
Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  -ArgumentList '--remote-debugging-port=9222','https://agent-arch.example.com/tasks/'
Start-Sleep -Seconds 6
```

The 6-second wait gives Edge time to restore your session and load the page. If the site requires re-authentication, sign in manually now before proceeding.

### 3. Start the agent-browser daemon

The `ab` CLI communicates with a background daemon over TCP. Start it via Node.js:

```javascript
const { spawn } = require('child_process');
const path = require('path');

const daemonPath = path.join(
  process.env.APPDATA,
  'npm', 'node_modules', 'agent-browser', 'dist', 'daemon.js'
);

const child = spawn(process.execPath, [daemonPath], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, AGENT_BROWSER_DAEMON: '1' },
  cwd: path.join(process.env.APPDATA, 'npm', 'node_modules', 'agent-browser'),
  windowsHide: true
});
child.unref();
```

### 4. Connect to Edge via CDP

Send a launch command with the CDP port instead of launching a new browser:

```javascript
const result = await send({
  id: 'connect-cdp',
  action: 'launch',
  cdpPort: 9222
});
```

### 5. Find and switch to the authenticated tab

```javascript
// List all tabs
const tabs = await send({ id: 'tabs', action: 'tab_list' });
console.log('Tabs:', JSON.stringify(tabs));

// Switch to the agent-arch tab (check tab_list output for correct index)
await send({ id: 'sw', action: 'tab_switch', index: 2 });

// Take an interactive snapshot to verify authentication
const snap = await send({ id: 'snap', action: 'snapshot', interactive: true });
console.log(snap);
```

The tab index for agent-arch is typically index 2 (Edge opens internal tabs at 0 and 1). Always verify with `tab_list` first.

## Node.js Helper Functions

Copy-paste these into any Node.js script or `node -e` one-liner:

```javascript
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

// Calculate daemon TCP port from session name
function getPort(sess) {
  let hash = 0;
  for (let i = 0; i < sess.length; i++) {
    hash = (hash << 5) - hash + sess.charCodeAt(i);
    hash |= 0;
  }
  return 49152 + (Math.abs(hash) % 16383);
}
const port = getPort('default');

// Send JSON command to daemon via TCP
function send(cmd) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
      socket.write(JSON.stringify(cmd) + '\n');
    });
    let data = '';
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.includes('\n')) {
        try { resolve(JSON.parse(data.trim().split('\n').pop())); }
        catch { resolve({ raw: data }); }
        socket.destroy();
      }
    });
    socket.on('error', reject);
    setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, 15000);
  });
}

// Poll until daemon is accepting connections
async function waitForDaemon() {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      await send({ id: 'ping', action: 'title' });
      return true;
    } catch {}
  }
  return false;
}
```

## Complete Working Script

End-to-end: start daemon, connect CDP, list tabs, snapshot the authenticated page.

```javascript
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

function getPort(sess) {
  let hash = 0;
  for (let i = 0; i < sess.length; i++) {
    hash = (hash << 5) - hash + sess.charCodeAt(i);
    hash |= 0;
  }
  return 49152 + (Math.abs(hash) % 16383);
}
const port = getPort('default');

function send(cmd) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
      socket.write(JSON.stringify(cmd) + '\n');
    });
    let data = '';
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.includes('\n')) {
        try { resolve(JSON.parse(data.trim().split('\n').pop())); }
        catch { resolve({ raw: data }); }
        socket.destroy();
      }
    });
    socket.on('error', reject);
    setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, 15000);
  });
}

async function waitForDaemon() {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try { await send({ id: 'ping', action: 'title' }); return true; } catch {}
  }
  return false;
}

(async () => {
  // Start daemon
  const daemonPath = path.join(
    process.env.APPDATA, 'npm', 'node_modules',
    'agent-browser', 'dist', 'daemon.js'
  );
  spawn(process.execPath, [daemonPath], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, AGENT_BROWSER_DAEMON: '1' },
    cwd: path.join(process.env.APPDATA, 'npm', 'node_modules', 'agent-browser'),
    windowsHide: true
  }).unref();

  console.log('Waiting for daemon...');
  await waitForDaemon();
  console.log('Daemon ready');

  // Connect to Edge via CDP
  const r1 = await send({ id: 'cdp', action: 'launch', cdpPort: 9222 });
  console.log('CDP:', JSON.stringify(r1));

  if (r1.success) {
    // List all tabs
    const r2 = await send({ id: 'tabs', action: 'tab_list' });
    console.log('Tabs:', JSON.stringify(r2));

    // Switch to authenticated tab (verify index from tab_list output)
    const r3 = await send({ id: 'sw', action: 'tab_switch', index: 2 });
    console.log('Switched:', JSON.stringify(r3));

    // Get interactive snapshot
    const r4 = await send({ id: 'snap', action: 'snapshot', interactive: true });
    console.log('Snapshot:', r4);
  }
})();
```

## Common Interaction Commands

Once connected, use `send()` to interact:

```javascript
// Snapshot - get all interactive elements with refs
await send({ id: 's', action: 'snapshot', interactive: true });

// Click an element by ref
await send({ id: 'c', action: 'click', ref: 'e4' });

// Fill a text field
await send({ id: 'f', action: 'fill', ref: 'e21', value: 'search query' });

// Screenshot to file
await send({ id: 'ss', action: 'screenshot', path: path.join(os.tmpdir(), 'page.png') });

// Get text content of an element
await send({ id: 'gt', action: 'gettext', ref: 'e1' });

// Navigate to a URL
await send({ id: 'nav', action: 'open', url: 'https://agent-arch.example.com/dashboard' });

// Switch tabs
await send({ id: 'tab', action: 'tab_list' });
await send({ id: 'tab', action: 'tab_switch', index: 0 });
```

## Agent-Arch Page Structure

When authenticated, the snapshot reveals this navigation sidebar:

| Ref | Nav Link |
|-----|----------|
| e1 | Dashboard |
| e2 | Proposals & Decisions |
| e3 | Meetings Hub |
| e4 | Tasks |
| e5 | Agents |
| e6 | Governance |
| e7 | Budget & Licensing |
| e8 | Resources Library |
| e9 | Tech Radar |
| e10 | Architecture Lab |
| e11 | Feedback Hub |
| e12 | Audit Trail |
| e13 | Example AI Guide |
| e14 | User Memories |
| e15 | Feature Updates |
| e16 | User Management |
| e17 | Access Requests |
| e18 | User menu button |

### Tasks Page Elements

| Ref | Element |
|-----|---------|
| e19 | Tab: "Architecture Tasks" |
| e20 | Tab: "Feedback Tasks" |
| e21 | Search input |
| e22 | Filters |
| e23 | Button: "New Task" |

## Gotchas

### Edge ignores `--remote-debugging-port` if already running
You MUST kill all Edge processes before launching with CDP. Even a background Edge process (tray icon, PWA) will claim the port. The `Stop-Process` step is not optional.

### Daemon conflicts with `ab` CLI
If you started the daemon via Node.js `spawn()`, the `ab` CLI may fail because it tries to start its own daemon instance. Use `send()` for direct TCP communication instead of mixing `ab` CLI calls with manual daemon management.

### Tab index varies
CDP exposes ALL targets (pages, iframes, service workers). The agent-arch tab is typically at index 2, but this depends on what Edge restores on startup. Always check `tab_list` output first.

### Screenshot path escaping on Windows
Backslashes get mangled when passed through multiple layers. Use `path.join(os.tmpdir(), 'filename.png')` to generate paths safely.

### PowerShell `$_` variable mangled via bash
If calling PowerShell from git bash, `$_` becomes `extglob`. Use explicit variable names or run PowerShell commands directly.

### SSO cannot be automated
Microsoft SSO uses COOP headers that block Playwright popup handling. The user must sign in manually in the headed Edge browser. CDP gives Claude access to the already-authenticated session -- it does not bypass authentication.

### Session persistence
If Edge's session expires, you'll see an unauthenticated page in the snapshot (sign-in button instead of nav links). Close Edge, sign in again via normal browser use, then repeat the CDP setup.
