// @rhwp/core 을 받아 뷰어 assets 에 넣는다.
//
//   node tools/sync-rhwp.mjs              # engine/rhwp.version 고정 버전
//   node tools/sync-rhwp.mjs --latest     # npm latest 로 올리고 버전 파일도 갱신
//   node tools/sync-rhwp.mjs --version 0.8.7
//
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionFile = path.join(root, "engine", "rhwp.version");
const cacheRoot = path.join(root, "engine", "cache", "@rhwp", "core");
const viewerDir = path.join(root, "app", "src", "main", "assets", "viewer");
const REGISTRY = "https://registry.npmjs.org/@rhwp/core";

const FILES = [
  { from: "package/rhwp.js", to: "rhwp.js" },
  { from: "package/rhwp_bg.wasm", to: "rhwp_bg.wasm" },
  { from: "package/LICENSE", to: "LICENSE-rhwp.txt" },
];

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.error) {
    throw new Error(`${cmd} 실행 실패: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stdout || "") + (result.stderr || "");
    throw new Error(`${cmd} ${args.join(" ")} 실패\n${detail}`);
  }
  return (result.stdout || "").trim();
}

function parseArgs(argv) {
  let latest = false;
  let version = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--latest") latest = true;
    else if (arg === "--version") version = argv[++i];
    else if (arg.startsWith("--version=")) version = arg.slice("--version=".length);
  }
  return { latest, version };
}

function readPinned() {
  if (!fs.existsSync(versionFile)) {
    throw new Error(`버전 파일이 없습니다: ${versionFile}`);
  }
  const pinned = fs.readFileSync(versionFile, "utf8").trim();
  if (!/^\d+\.\d+\.\d+/.test(pinned)) {
    throw new Error(`engine/rhwp.version 형식이 올바르지 않습니다: ${pinned}`);
  }
  return pinned;
}

function writePin(version) {
  fs.mkdirSync(path.dirname(versionFile), { recursive: true });
  fs.writeFileSync(versionFile, `${version}\n`, "utf8");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`npm 조회 실패 (${response.status}): ${url}`);
  }
  return response.json();
}

async function resolveVersion({ latest, version }) {
  if (latest) {
    const meta = await fetchJson(`${REGISTRY}/latest`);
    const resolved = meta.version;
    writePin(resolved);
    console.log(`rhwp pin -> ${resolved} (latest)`);
    return resolved;
  }
  if (version) {
    writePin(version);
    console.log(`rhwp pin -> ${version}`);
    return version;
  }
  const pinned = readPinned();
  console.log(`rhwp pin = ${pinned}`);
  return pinned;
}

function cacheReady(version) {
  const dir = path.join(cacheRoot, version);
  return FILES.every((file) => fs.existsSync(path.join(dir, path.basename(file.from))));
}

async function downloadToCache(version) {
  const dir = path.join(cacheRoot, version);
  fs.mkdirSync(dir, { recursive: true });
  const packDir = path.join(cacheRoot, ".pack");
  fs.mkdirSync(packDir, { recursive: true });

  const meta = await fetchJson(`${REGISTRY}/${version}`);
  const tarball = meta?.dist?.tarball;
  if (!tarball) {
    throw new Error(`@rhwp/core@${version} tarball 주소를 찾지 못했습니다.`);
  }

  const tgz = path.join(packDir, `core-${version}.tgz`);
  console.log(`download ${tarball}`);
  const response = await fetch(tarball);
  if (!response.ok || !response.body) {
    throw new Error(`tarball 다운로드 실패 (${response.status}): ${tarball}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tgz));

  const extractDir = path.join(packDir, `extract-${version}`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  run("tar", ["-xzf", tgz, "-C", extractDir]);

  for (const file of FILES) {
    const src = path.join(extractDir, file.from);
    if (!fs.existsSync(src)) {
      throw new Error(`패키지에 ${file.from} 가 없습니다.`);
    }
    fs.copyFileSync(src, path.join(dir, path.basename(file.from)));
  }
  fs.writeFileSync(path.join(dir, "version"), `${version}\n`, "utf8");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(tgz, { force: true });
  console.log(`cached ${dir}`);
}

function installFromCache(version) {
  const dir = path.join(cacheRoot, version);
  fs.mkdirSync(viewerDir, { recursive: true });
  for (const file of FILES) {
    const src = path.join(dir, path.basename(file.from));
    const dest = path.join(viewerDir, file.to);
    fs.copyFileSync(src, dest);
  }
  fs.writeFileSync(path.join(viewerDir, "rhwp-version.txt"), `${version}\n`, "utf8");
  console.log(`installed @rhwp/core@${version} -> ${path.relative(root, viewerDir)}`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const version = await resolveVersion(args);
  if (!cacheReady(version)) await downloadToCache(version);
  else console.log(`cache hit ${version}`);
  installFromCache(version);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
