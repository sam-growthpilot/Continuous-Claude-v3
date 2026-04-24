# The Ultimate Guide to Claude Code: 27 Concepts from Zero to Expert

## I. Introduction: The Mental Model
*   **The Problem:** Claude Code looks intimidating (black screen, blinking cursor, technical jargon like MCP/Context Window).
*   **The Solution:** A breakdown of 27 core concepts explained in under 60 seconds each to build a solid mental model.
*   **The Goal:** Move from second-guessing commands to confident building, slower builds, and shipping automations.

## II. Part 1: The Foundations (Concepts 1–8)

### 1. What is Claude Code?
*   **Distinction:** Unlike browser-based chatbots (ChatGPT/Claude.ai) which give *advice*, Claude Code takes *action*.
*   **Capabilities:** It runs locally on your machine to create files, build websites, set up databases, and install packages.
*   **Interface:** Controlled via natural language conversation, not complex coding syntax.

### 2. The Terminal
*   **Definition:** The text-based interface used to interact with the computer.
*   **Simplicity:** You do not need to be a terminal wizard. You only need to know:
    *   **Start:** Type `claude`.
    *   **Stop:** Hit `Ctrl+C` twice.
    *   **Clear Memory:** Type `/clear`.

### 3. Prompts
*   **Definition:** The plain English instructions you type to tell Claude what to do.
*   **Best Practice:** Be specific.
    *   *Bad:* "Build a website."
    *   *Good:* "Build a one-page landing page for a consulting business with a green color scheme, a contact form, and three service cards."

### 4. Permissions
*   **The Safety Mechanism:** Because Claude acts on your computer, it asks for approval before significant actions (editing files, running commands).
*   **The Friction:** Clicking "approve" every 10 seconds kills flow.
*   **The Fix:** Use a `settings.json` file (accessed via `/permissions`) to create an **Allow List**.
    *   *Safe to Allow:* Reading files (`cat`, `ls`), running tests (`npm test`), Git operations (`git status`, `git add`).
    *   *Keep Gated:* Installing packages, deleting files, internet access (`curl`).
*   **The Nuclear Option:** `--dangerously-skip-permissions` (Not recommended, even by the creator).

### 5. Tools
*   **Capabilities:** Built-in functions Claude uses to interact with your system.
    *   **Read:** Looking at files/data.
    *   **Write:** Creating new files.
    *   **Bash:** Running terminal commands.
*   **Automation:** The user defines the *goal*; Claude automatically selects the correct *tool* (e.g., using `ls` to list files).

### 6. Context Window
*   **Definition:** Claude's short-term memory. It includes every message, file read, and response in the current session.
*   **The Limit:** Context has a hard cap. As it fills up, "Context Rot" occurs (Claude forgets earlier instructions).
*   **Tracking:** Visible via the green bar at the bottom of the terminal interface.

### 7. Conversation History
*   **Persistence:** Claude Code automatically saves session history.
*   **Resuming:** Type `claude --resume` to see a list of past sessions and jump back in exactly where you left off.
*   **Use Case:** Returning to a project the next day without having to re-explain the context.

### 8. Token Usage
*   **The Cost Metric:** 1 Token ≈ 0.75 words.
*   **Billing:** You pay for input tokens (prompts/files read) and output tokens (Claude's response).
*   **Monitoring:** Use `/cost` or `/stats` to see exactly what a session has cost you.

## III. Part 2: Making Claude Personal (Concepts 9–14)

### 9. CLAUDE.md
*   **Definition:** The "Instruction Manual" file you create in your project root.
*   **Function:** Claude reads this *every single time* it starts.
*   **Content:** High-level project rules (e.g., "Use TypeScript," "Use Brand Voice," "Don't use em-dashes").
*   **Importance:** The single most critical file for consistent project results.

### 10. Memory (Auto-Memory)
*   **Definition:** Persistent memory across different sessions (unlike the Context Window).
*   **Mechanism:** Claude automatically notes patterns (e.g., "User prefers Javascript") and saves them.
*   **Management:** You can explicitly ask Claude to "Add," "Remove," or "Review" what it knows about you.

### 11. Compact Context
*   **The Problem:** Long conversations fill the context window.
*   **The Solution (Auto):** At ~85-95% capacity, Claude summarizes key info and clears the noise automatically.
*   **The Solution (Manual):** Type `/compact` to force a summary. You can add arguments like `/compact keep info about API calls` to retain specific details.

### 12. Models
*   **The Family:** "Claude Code" is the interface; the intelligence comes from specific models.
    *   **Haiku:** Fastest, cheapest. Good for simple edits.
    *   **Sonnet:** The middle-ground. Reliable, reasonably priced. (The Default).
    *   **Opus:** Most intelligent, most expensive. Best for complex architecture.
*   **Switching:** Type `/model` to switch mid-conversation.

### 13. File Access Denial
*   **Security:** Not every file should be read (e.g., huge data files or sensitive `.env` files).
*   **Implementation:** Add a "Deny" list in `settings.json`.
*   **Result:** Claude cannot read or search these files even if asked directly.

### 14. Flags
*   **Definition:** Launch settings applied when starting Claude Code.
*   **Examples:**
    *   `--model sonnet` (Start with a specific model).
    *   `--verbose` (Show detailed logs of what Claude is thinking/doing).
    *   `--allowed-tools` (Restrict capabilities).

## IV. Part 3: Power Features (Concepts 15–18)

### 15. Extended Thinking
*   **Definition:** A dedicated "Reasoning Budget" (in tokens) for complex problems.
*   **Function:** Claude "thinks" step-by-step before responding.
*   **Status:** Now enabled by default with a max token cap (no need to type "think hard").

### 16. Commands (Slash Commands)
*   **Definition:** Shortcuts for repetitive tasks.
*   **Key Commands:**
    *   `/init`: Sets up a new project and creates `CLAUDE.md`.
    *   `/clear`: Wipes conversation context.
    *   `/help`: Lists all available commands.
    *   *Custom:* You can turn frequent tasks into custom slash commands stored in the `.claude` folder.

### 17. Skills
*   **Definition:** Pre-written instructional playbooks for specific tasks (e.g., "Social Media Strategy," "Frontend Design").
*   **Difference from Prompts:** Skills include supporting files and best practices loaded only when that specific skill is invoked.
*   **Mechanism:** Claude reads the skill definition and applies that specific expertise to the build.

### 18. Hooks
*   **Definition:** Custom scripts that trigger automatically after specific events *without* using AI tokens.
*   **Use Cases:**
    *   *Auto-format:* Run a formatter every time Claude saves a file.
    *   *Logging:* Record every command Claude runs into a log file.

## V. Part 4: Using Claude Autonomously (Concepts 19–23)

### 19. MCP Servers (Model Context Protocol)
*   **The Connector:** Bridges Claude Code (local) with external tools (cloud).
*   **Capabilities:** Allows Claude to interact with Notion, GitHub, Linear, Airtable, or local databases.
*   **Workflow:** Connect an MCP server -> Claude can pull data, push updates, and manage your full stack stack from the terminal.

### 20. Sub-agents
*   **Architecture:** Hub-and-Spoke model.
*   **Function:** The Main Agent spins up "Specialist" sub-agents.
*   **Benefit:**
    *   *Quality:* Sub-agents have clean context windows.
    *   *Speed:* Multiple sub-agents can run in parallel.
*   **Limitation:** Sub-agents report back to the Main Agent; they cannot talk to each other.

### 21. Agent Teams
*   **Architecture:** Mesh Network (Peer-to-Peer).
*   **Function:** An evolution of sub-agents where team members *can* communicate directly and share a task list.
*   **Use Case:** Complex builds (e.g., SaaS App) requiring an API Dev, Frontend Dev, and Tester working simultaneously and coordinating.

### 22. Image/Screenshot Support
*   **Multimodal Input:** Claude can "see."
*   **Workflow:** Paste a screenshot of a bug or a design mock-up into the terminal.
*   **Efficiency:** Much faster than describing a visual layout or error message in text.

### 23. Checkpoints / Undo
*   **Safety Net:** Claude automatically creates snapshots *before* every file edit.
*   **The Command:** `/rewind`.
*   **Functionality:** Opens a list of previous states. You can revert code changes while keeping the conversation history, or revert both.

## VI. Part 5: Practical Application (Concepts 24–27)

### 24. Git Integration
*   **Version Control:** The engine powering the checkpoint system.
*   **Automation:** Connect your GitHub account to let Claude review changes, stage files, and commit code automatically.

### 25. Headless Mode (CLI Mode)
*   **The Flag:** `-p` (print).
*   **Function:** Runs a full agentic loop without human interaction/conversation.
*   **Workflow:** Command + `-p` -> Claude attempts to complete the task and exits only when done.
*   **The "Ralph Loop":** A plugin that allows Claude to run in a continuous `while` loop, re-feeding the prompt and current file state until the task is verified complete (great for overnight builds).

### 26. Claude Max vs. API
*   **Pricing Models:**
    *   **Subscription (Pro/Max):** Flat monthly fee ($20 - $200). Generous limits. Predictable cost. *Recommended for heavy building.*
    *   **API (Pay-as-you-go):** Pay per token. Good for light usage, but costs spike during complex, multi-agent builds.

### 27. Worktrees
*   **The Concept:** Parallel Universes for your code.
*   **Function:** Creates separate working directories that share the same repo history but have their own files and branches.
*   **Use Case:** Have "Claude A" building a new feature in one terminal while "Claude B" fixes a bug in another terminal, without them overwriting each other's files.
*   **Command:** `claude --worktree [feature-name]`.
*   **Cleanup:** Claude handles merging and deleting the directory when the task is done.