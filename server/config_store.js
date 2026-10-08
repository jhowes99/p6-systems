/**
 * Config persistence: secureMode, password hash (PBKDF2) for Secure Mode.
 * Store in server/data/config.json
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

const PBKDF2_ITERATIONS = 100000;
const SALT_LEN = 16;
const KEY_LEN = 32;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readConfig() {
  try {
    ensureDir(DATA_DIR);
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (e) {
    // ignore
  }
  return { secureMode: false };
}

export function getConfig() {
  return readConfig();
}

const DEFAULT_LICENSE_TIER = "core";
export function getLicenseTier() {
  const cfg = readConfig();
  const t = (cfg.licenseTier || DEFAULT_LICENSE_TIER).toLowerCase();
  return t === "pro" || t === "enterprise" ? t : "core";
}

export function setLicenseTier(tier) {
  const t = String(tier || "").toLowerCase();
  const value = t === "pro" || t === "enterprise" ? t : "core";
  setConfig({ licenseTier: value });
  return value;
}

export function setConfig(updates) {
  const current = readConfig();
  const next = { ...current, ...updates };
  ensureDir(DATA_DIR);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function setSecureMode(on) {
  return setConfig({ secureMode: !!on });
}

export function setPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN).toString("hex");
  const hash = crypto.pbkdf2Sync(
    String(password),
    salt,
    PBKDF2_ITERATIONS,
    KEY_LEN,
    "sha256"
  ).toString("hex");
  setConfig({ passwordHash: hash, salt });
  return { ok: true };
}

export function verifyPassword(password) {
  const cfg = readConfig();
  const salt = cfg.salt;
  const storedHash = cfg.passwordHash;
  if (!salt || !storedHash) return false;
  const hash = crypto.pbkdf2Sync(
    String(password),
    salt,
    PBKDF2_ITERATIONS,
    KEY_LEN,
    "sha256"
  ).toString("hex");
  return hash === storedHash;
}

/** Optional admin passcode for adding validation exceptions (accept as exception). */
export function setValidationExceptionPasscode(passcode) {
  if (passcode == null || String(passcode).trim() === "") {
    const cfg = readConfig();
    delete cfg.validationExceptionPasscodeHash;
    delete cfg.validationExceptionPasscodeSalt;
    setConfig(cfg);
    return { ok: true };
  }
  const salt = crypto.randomBytes(SALT_LEN).toString("hex");
  const hash = crypto.pbkdf2Sync(
    String(passcode),
    salt,
    PBKDF2_ITERATIONS,
    KEY_LEN,
    "sha256"
  ).toString("hex");
  setConfig({ validationExceptionPasscodeHash: hash, validationExceptionPasscodeSalt: salt });
  return { ok: true };
}

export function hasValidationExceptionPasscode() {
  const cfg = readConfig();
  return !!(cfg.validationExceptionPasscodeSalt && cfg.validationExceptionPasscodeHash);
}

export function verifyValidationExceptionPasscode(passcode) {
  const cfg = readConfig();
  const salt = cfg.validationExceptionPasscodeSalt;
  const storedHash = cfg.validationExceptionPasscodeHash;
  if (!salt || !storedHash) return true;
  const hash = crypto.pbkdf2Sync(
    String(passcode),
    salt,
    PBKDF2_ITERATIONS,
    KEY_LEN,
    "sha256"
  ).toString("hex");
  return hash === storedHash;
}
