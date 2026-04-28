#!/usr/bin/env node

// src/prd-roadmap-sync.ts
import * as fs from "fs";
import * as path from "path";

// src/shared/roadmap-parser.ts
var SECTION_PREFIXES = [
  // Order matters: more specific first.
  { key: "sessions", prefix: "## recent planning" },
  { key: "current", prefix: "## current" },
  { key: "completed", prefix: "## completed" },
  { key: "planned", prefix: "## planned" }
];
function detectSection(strippedLower) {
  for (const { key, prefix } of SECTION_PREFIXES) {
    if (strippedLower.startsWith(prefix)) {
      return key;
    }
  }
  if (strippedLower.startsWith("## ")) {
    return null;
  }
  return void 0;
}
function bucketize(rawPriority) {
  const p = rawPriority.toLowerCase();
  if (p.includes("high")) return "high";
  if (p.includes("low")) return "low";
  return "medium";
}
function parseRoadmap(content) {
  const result = {
    current: null,
    completed: [],
    planned: [],
    sessions: [],
    rawContent: content,
    rawSections: /* @__PURE__ */ new Map()
  };
  if (!content) return result;
  const lines = content.split("\n");
  let section = null;
  let sectionStart = -1;
  const closeSection = (endLine) => {
    if (section && sectionStart >= 0) {
      result.rawSections.set(section, { start: sectionStart, end: endLine });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();
    const lower = stripped.toLowerCase();
    const detected = detectSection(lower);
    const isAnyH2 = stripped.startsWith("## ");
    const isKnownH2 = typeof detected === "string";
    const isUnrelatedH2 = detected === null;
    if (isKnownH2) {
      closeSection(i);
      section = detected;
      sectionStart = i;
      continue;
    }
    if (isUnrelatedH2) {
      closeSection(i);
      section = null;
      sectionStart = -1;
      continue;
    }
    if (section === "current") {
      if (stripped.startsWith("**") && stripped.endsWith("**") && stripped.length >= 4) {
        const title = stripped.replace(/\*\*/g, "").trim();
        if (title.length > 0) {
          result.current = { title };
        }
        continue;
      }
      const checkboxCurrent = stripped.match(/^-\s*\[\s*\]\s*(.+)$/);
      if (checkboxCurrent && !result.current) {
        result.current = { title: checkboxCurrent[1].trim() };
        continue;
      }
      if (result.current && stripped.startsWith("- ")) {
        const text = stripped.slice(2).trim();
        if (/^started:/i.test(text)) {
          result.current.started = text.replace(/^started:\s*/i, "").trim();
        } else if (/^progress:/i.test(text)) {
          result.current.progress = text.replace(/^progress:\s*/i, "").trim();
        } else {
          if (result.current.description) {
            result.current.description = `${result.current.description}; ${text}`;
          } else {
            result.current.description = text;
          }
        }
        continue;
      }
    }
    if (section === "completed") {
      const m = stripped.match(/^-\s*\[x\]\s*(.+?)(?:\s*\(([^)]+)\))?$/i);
      if (m) {
        result.completed.push({
          title: m[1].trim(),
          completed: m[2] || ""
        });
      }
      continue;
    }
    if (section === "planned") {
      const m = stripped.match(/^-\s*\[\s*\]\s*(.+?)(?:\s*\(([^)]+)\))?$/);
      if (m) {
        const rawPriority = m[2] || "normal";
        result.planned.push({
          title: m[1].trim(),
          priority: rawPriority,
          priorityBucket: bucketize(rawPriority)
        });
      }
      continue;
    }
    if (section === "sessions") {
      const sessHeader = stripped.match(/^###\s*(\d{4}-\d{2}-\d{2}):\s*(.+)$/);
      if (sessHeader) {
        result.sessions.push({
          date: sessHeader[1],
          title: sessHeader[2].trim(),
          decisions: []
        });
        continue;
      }
      if (result.sessions.length > 0 && stripped.startsWith("-")) {
        const last = result.sessions[result.sessions.length - 1];
        last.decisions.push(stripped.slice(1).trim());
      }
      continue;
    }
  }
  closeSection(lines.length);
  return result;
}

// src/prd-roadmap-sync.ts
function readStdin() {
  return new Promise((resolve2) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve2(data));
    setTimeout(() => resolve2(data), 100);
  });
}
function isPRDFile(filePath) {
  const basename2 = path.basename(filePath).toLowerCase();
  return basename2.startsWith("prd-") && basename2.endsWith(".md");
}
function isTasksFile(filePath) {
  const basename2 = path.basename(filePath).toLowerCase();
  return basename2.startsWith("tasks-") && basename2.endsWith(".md");
}
function extractPRDMetadata(content) {
  const result = {
    title: "Untitled PRD",
    status: "Draft",
    priority: "Normal",
    version: "1.0",
    created: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
  };
  const lines = content.split("\n");
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith("# ") && result.title === "Untitled PRD") {
      result.title = stripped.slice(2).trim();
    }
    if (stripped.toLowerCase().startsWith("**status:**")) {
      result.status = stripped.replace(/^\*\*status:\*\*/i, "").trim();
    }
    if (stripped.toLowerCase().startsWith("**priority:**")) {
      result.priority = stripped.replace(/^\*\*priority:\*\*/i, "").trim();
    }
    if (stripped.toLowerCase().startsWith("**version:**")) {
      result.version = stripped.replace(/^\*\*version:\*\*/i, "").trim();
    }
    if (stripped.toLowerCase().startsWith("**created:**")) {
      result.created = stripped.replace(/^\*\*created:\*\*/i, "").trim();
    }
  }
  return result;
}
function extractTaskProgress(content, filePath) {
  const basename2 = path.basename(filePath);
  const featureMatch = basename2.match(/tasks?-(.+)\.md/i);
  const featureName = featureMatch ? featureMatch[1].replace(/-/g, " ") : "Unknown Feature";
  const dir = path.dirname(filePath);
  const prdPattern = basename2.replace(/^tasks?-/i, "prd-");
  const prdPath = path.join(dir, prdPattern.replace("tasks-", "PRD-"));
  const prdFile = fs.existsSync(prdPath) ? prdPath : null;
  const taskPattern = /^-\s*\[([ x])\]/gm;
  let match;
  let total = 0;
  let completed = 0;
  while ((match = taskPattern.exec(content)) !== null) {
    total++;
    if (match[1].toLowerCase() === "x") {
      completed++;
    }
  }
  const percentage = total > 0 ? Math.round(completed / total * 100) : 0;
  return {
    featureName,
    prdFile,
    total,
    completed,
    percentage,
    isComplete: total > 0 && completed === total
  };
}
function findRoadmapPath(startDir) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) {
    const roadmap = path.join(projectDir, "ROADMAP.md");
    if (fs.existsSync(roadmap)) return roadmap;
    const claudeRoadmap = path.join(projectDir, ".claude", "ROADMAP.md");
    if (fs.existsSync(claudeRoadmap)) return claudeRoadmap;
    return roadmap;
  }
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  let projectRoot = null;
  while (current !== root) {
    if (fs.existsSync(path.join(current, ".git")) || fs.existsSync(path.join(current, "package.json"))) {
      projectRoot = current;
      break;
    }
    current = path.dirname(current);
  }
  if (projectRoot) {
    const candidate = path.join(projectRoot, "ROADMAP.md");
    if (fs.existsSync(candidate)) return candidate;
    const claudeCandidate = path.join(projectRoot, ".claude", "ROADMAP.md");
    if (fs.existsSync(claudeCandidate)) return claudeCandidate;
    return candidate;
  }
  return null;
}
function itemExists(items, title) {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  return items.some((item) => {
    const itemNormalized = item.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    return itemNormalized.includes(normalized) || normalized.includes(itemNormalized);
  });
}
function addToPlanned(content, item) {
  const lines = content.split("\n");
  const result = [];
  let addedToPlanned = false;
  let inPlanned = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim().toLowerCase();
    if (stripped.startsWith("## planned")) {
      inPlanned = true;
      result.push(lines[i]);
      const priority = item.priority || "normal";
      const source = item.source ? ` [${item.source}]` : "";
      result.push(`- [ ] ${item.title}${source} (${priority})`);
      addedToPlanned = true;
      continue;
    } else if (stripped.startsWith("## ") && inPlanned) {
      inPlanned = false;
    }
    result.push(lines[i]);
  }
  if (!addedToPlanned) {
    result.push("");
    result.push("## Planned");
    const priority = item.priority || "normal";
    const source = item.source ? ` [${item.source}]` : "";
    result.push(`- [ ] ${item.title}${source} (${priority})`);
  }
  return result.join("\n");
}
function updateProgress(content, title, progress) {
  const lines = content.split("\n");
  const result = [];
  let inCurrent = false;
  let foundTitle = false;
  let progressUpdated = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const lower = stripped.toLowerCase();
    if (lower.startsWith("## current")) {
      inCurrent = true;
      result.push(lines[i]);
      continue;
    } else if (lower.startsWith("## ") && inCurrent) {
      inCurrent = false;
    }
    if (inCurrent) {
      if (stripped.startsWith("**") && stripped.includes(title.split(" ")[0])) {
        foundTitle = true;
        result.push(lines[i]);
        continue;
      }
      if (foundTitle && stripped.toLowerCase().startsWith("- progress:")) {
        result.push(`- Progress: ${progress.completed}/${progress.total} tasks (${progress.percentage}%)`);
        progressUpdated = true;
        continue;
      }
    }
    result.push(lines[i]);
  }
  if (foundTitle && !progressUpdated) {
    const newResult = [];
    let inserted = false;
    inCurrent = false;
    for (let i = 0; i < result.length; i++) {
      newResult.push(result[i]);
      const stripped = result[i].trim();
      const lower = stripped.toLowerCase();
      if (lower.startsWith("## current")) {
        inCurrent = true;
        continue;
      }
      if (inCurrent && !inserted && stripped.startsWith("**") && stripped.includes(title.split(" ")[0])) {
        newResult.push(`- Progress: ${progress.completed}/${progress.total} tasks (${progress.percentage}%)`);
        inserted = true;
      }
    }
    return newResult.join("\n");
  }
  return result.join("\n");
}
function moveToCompleted(content, title) {
  const lines = content.split("\n");
  const result = [];
  let inCurrent = false;
  let skipUntilNextSection = false;
  let completedInsertIndex = -1;
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const lower = stripped.toLowerCase();
    if (lower.startsWith("## current")) {
      inCurrent = true;
      result.push(lines[i]);
      continue;
    } else if (lower.startsWith("## completed")) {
      inCurrent = false;
      skipUntilNextSection = false;
      completedInsertIndex = result.length + 1;
      result.push(lines[i]);
      result.push(`- [x] ${title} (${today})`);
      continue;
    } else if (lower.startsWith("## ") && inCurrent) {
      inCurrent = false;
      skipUntilNextSection = false;
    }
    if (inCurrent) {
      if (stripped.startsWith("**") && stripped.toLowerCase().includes(title.toLowerCase().split(" ")[0])) {
        skipUntilNextSection = true;
        result.push("");
        result.push("_No current goal. Run /init-project or start a new PRD._");
        result.push("");
        continue;
      }
      if (skipUntilNextSection) {
        continue;
      }
    }
    result.push(lines[i]);
  }
  return result.join("\n");
}
function promoteToCurrent(content, item) {
  const lines = content.split("\n");
  const result = [];
  let inCurrent = false;
  let inPlanned = false;
  let removedFromPlanned = false;
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const lower = stripped.toLowerCase();
    if (lower.startsWith("## current")) {
      inCurrent = true;
      result.push(lines[i]);
      result.push("");
      result.push(`**${item.title}**`);
      result.push(`- Started: ${today}`);
      if (item.source) {
        result.push(`- Source: ${item.source}`);
      }
      result.push(`- Progress: 0/? tasks (0%)`);
      result.push("");
      continue;
    } else if (lower.startsWith("## planned")) {
      inCurrent = false;
      inPlanned = true;
      result.push(lines[i]);
      continue;
    } else if (lower.startsWith("## ")) {
      inCurrent = false;
      inPlanned = false;
    }
    if (inCurrent && stripped.includes("No current goal")) {
      continue;
    }
    if (inPlanned && !removedFromPlanned && stripped.includes(item.title.split(" ")[0])) {
      removedFromPlanned = true;
      continue;
    }
    result.push(lines[i]);
  }
  return result.join("\n");
}
async function handlePRDChange(filePath, content) {
  const metadata = extractPRDMetadata(content);
  const fileDir = path.dirname(filePath);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!path.resolve(filePath).startsWith(path.resolve(projectDir))) {
    return {
      result: "continue",
      message: "PRD file is outside current project directory"
    };
  }
  const roadmapPath = findRoadmapPath(fileDir);
  if (!roadmapPath) {
    return {
      result: "continue",
      message: `PRD detected: "${metadata.title}" - No ROADMAP.md found to sync`
    };
  }
  const roadmapContent = fs.readFileSync(roadmapPath, "utf-8");
  const roadmap = parseRoadmap(roadmapContent);
  const allItems = [
    ...roadmap.current ? [roadmap.current] : [],
    ...roadmap.completed,
    ...roadmap.planned
  ];
  if (itemExists(allItems, metadata.title)) {
    return {
      result: "continue",
      message: `PRD "${metadata.title}" already in ROADMAP`
    };
  }
  const newItem = {
    title: metadata.title,
    priority: metadata.priority.toLowerCase(),
    source: path.basename(filePath)
  };
  const updated = addToPlanned(roadmapContent, newItem);
  fs.writeFileSync(roadmapPath, updated);
  return {
    result: "continue",
    message: `ROADMAP updated: Added "${metadata.title}" to Planned (from PRD)`
  };
}
async function handleTasksChange(filePath, content) {
  const progress = extractTaskProgress(content, filePath);
  const fileDir = path.dirname(filePath);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!path.resolve(filePath).startsWith(path.resolve(projectDir))) {
    return {
      result: "continue",
      message: "Tasks file is outside current project directory"
    };
  }
  const roadmapPath = findRoadmapPath(fileDir);
  if (!roadmapPath) {
    return {
      result: "continue",
      message: `Tasks progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`
    };
  }
  const roadmapContent = fs.readFileSync(roadmapPath, "utf-8");
  const roadmap = parseRoadmap(roadmapContent);
  const inPlanned = roadmap.planned.find(
    (item) => item.title.toLowerCase().includes(progress.featureName.toLowerCase().split(" ")[0])
  );
  const isCurrent = roadmap.current && roadmap.current.title.toLowerCase().includes(progress.featureName.toLowerCase().split(" ")[0]);
  let updated = roadmapContent;
  let message = "";
  if (progress.isComplete) {
    const titleToComplete = roadmap.current?.title || progress.featureName;
    updated = moveToCompleted(roadmapContent, titleToComplete);
    message = `ROADMAP updated: "${titleToComplete}" marked complete (100%)`;
  } else if (inPlanned && !roadmap.current) {
    updated = promoteToCurrent(roadmapContent, {
      title: inPlanned.title,
      source: path.basename(filePath)
    });
    message = `ROADMAP updated: Promoted "${inPlanned.title}" to Current`;
  } else if (isCurrent) {
    updated = updateProgress(roadmapContent, roadmap.current.title, progress);
    message = `ROADMAP progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`;
  } else if (inPlanned) {
    message = `Tasks started for planned item "${inPlanned.title}" - will promote when current goal completes`;
  } else {
    message = `Tasks progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`;
  }
  if (updated !== roadmapContent) {
    fs.writeFileSync(roadmapPath, updated);
  }
  return { result: "continue", message };
}
async function main() {
  const input = await readStdin();
  if (!input.trim()) {
    console.log(JSON.stringify({ result: "continue" }));
    return;
  }
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    console.log(JSON.stringify({ result: "continue" }));
    return;
  }
  if (!["Write", "Edit"].includes(data.tool_name)) {
    console.log(JSON.stringify({ result: "continue" }));
    return;
  }
  const filePath = data.tool_input.file_path;
  if (!filePath) {
    console.log(JSON.stringify({ result: "continue" }));
    return;
  }
  let result;
  if (isPRDFile(filePath)) {
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    result = await handlePRDChange(filePath, content);
  } else if (isTasksFile(filePath)) {
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    result = await handleTasksChange(filePath, content);
  } else {
    result = { result: "continue" };
  }
  console.log(JSON.stringify(result));
}
main().catch((err) => {
  console.error("[prd-roadmap-sync] Error:", err.message);
  console.log(JSON.stringify({ result: "continue" }));
});
