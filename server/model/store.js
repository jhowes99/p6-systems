/**
 * File-backed canonical model store.
 * Layout: server/data/canonical/meta.json + projects/<id>/project.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SCHEMA_VERSION, createEmptyProject, normalizeProject, bumpModelVersion } from "./schema.js";
import { migrateProject } from "./migrate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _rootOverride = null;

/** Test helper: redirect persistence root. */
export function setDataRootOverride(absolutePath) {
  _rootOverride = absolutePath ? path.resolve(absolutePath) : null;
}

function dataRoot() {
  if (_rootOverride) return _rootOverride;

  // Docker / npm start from repo root: <cwd>/server/data/canonical
  // npm start from server/: <cwd>/data/canonical
  const cwd = process.cwd();
  if (path.basename(cwd) === "server") {
    return path.join(cwd, "data", "canonical");
  }
  const fromCwd = path.join(cwd, "server", "data", "canonical");
  if (fs.existsSync(path.join(cwd, "server")) || fs.existsSync(fromCwd)) {
    return fromCwd;
  }
  // Fallback: next to this module (server/model → server/data/canonical)
  return path.join(__dirname, "..", "data", "canonical");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function metaPath() {
  return path.join(dataRoot(), "meta.json");
}

function projectsDir() {
  return path.join(dataRoot(), "projects");
}

function projectPath(projectId) {
  return path.join(projectsDir(), projectId, "project.json");
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function initStore() {
  ensureDir(projectsDir());
  if (!fs.existsSync(metaPath())) {
    writeJson(metaPath(), {
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activeProjectId: null
    });
  }
  return readJson(metaPath());
}

export function getMeta() {
  initStore();
  return readJson(metaPath(), {
    schemaVersion: SCHEMA_VERSION,
    activeProjectId: null
  });
}

function setMeta(updates) {
  const current = getMeta();
  const next = { ...current, ...updates, updatedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION };
  writeJson(metaPath(), next);
  return next;
}

export function listProjects() {
  initStore();
  const dir = projectsDir();
  if (!fs.existsSync(dir)) return [];
  const ids = fs.readdirSync(dir).filter((name) => {
    const full = path.join(dir, name);
    return fs.statSync(full).isDirectory() && fs.existsSync(projectPath(name));
  });
  const meta = getMeta();
  return ids
    .map((id) => {
      const p = loadProject(id);
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        modelVersion: p.modelVersion,
        schemaVersion: p.schemaVersion,
        updatedAt: p.updatedAt,
        equipmentCount: p.equipment?.length || 0,
        signalCount: p.signals?.length || 0,
        active: meta.activeProjectId === p.id
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function loadProject(projectId) {
  initStore();
  const file = projectPath(projectId);
  const raw = readJson(file, null);
  if (!raw) return null;
  const { project, migrationsApplied } = migrateProject(raw);
  if (migrationsApplied.length) {
    saveProject(project, { bumpVersion: false });
  }
  return project;
}

export function saveProject(project, { bumpVersion = true } = {}) {
  initStore();
  if (!project?.id) throw new Error("Project id required");
  let next = normalizeProject(project);
  if (bumpVersion) bumpModelVersion(next);
  else next.updatedAt = new Date().toISOString();
  writeJson(projectPath(next.id), next);
  return next;
}

export function createProject({ name, description = "", id: givenId } = {}) {
  const project = createEmptyProject({ name, description, id: givenId });
  writeJson(projectPath(project.id), project);
  const meta = getMeta();
  if (!meta.activeProjectId) setMeta({ activeProjectId: project.id });
  return loadProject(project.id);
}

export function deleteProject(projectId) {
  initStore();
  const dir = path.join(projectsDir(), projectId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  const meta = getMeta();
  if (meta.activeProjectId === projectId) {
    const remaining = listProjects().filter((p) => p.id !== projectId);
    setMeta({ activeProjectId: remaining[0]?.id || null });
  }
  return true;
}

export function getActiveProject() {
  const meta = getMeta();
  if (!meta.activeProjectId) return null;
  return loadProject(meta.activeProjectId);
}

export function setActiveProject(projectId) {
  const p = loadProject(projectId);
  if (!p) throw new Error(`Project not found: ${projectId}`);
  setMeta({ activeProjectId: projectId });
  return p;
}

/**
 * Update project via mutator; persists with modelVersion bump.
 */
export function updateProject(projectId, mutator) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const result = mutator(project);
  const next = result && result.id ? result : project;
  return saveProject(next, { bumpVersion: true });
}

export function getStorePaths() {
  return {
    root: dataRoot(),
    meta: metaPath(),
    projects: projectsDir()
  };
}
