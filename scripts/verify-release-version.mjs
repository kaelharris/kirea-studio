import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const SEMVER = /^\d+\.\d+\.\d+$/;
const RELEASE_REPOSITORY = "kaelharris/kirea-studio";

function parseJson(text, file, errors) {
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function collectSoftwareApplications(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectSoftwareApplications(item, found);
    return found;
  }
  const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (type.includes("SoftwareApplication")) found.push(value);
  for (const item of Object.values(value)) collectSoftwareApplications(item, found);
  return found;
}

export function verifyReleaseVersion(root = ROOT) {
  const errors = [];
  const read = (file) => {
    try {
      return fs.readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      errors.push(`${file}: unable to read (${error instanceof Error ? error.message : String(error)})`);
      return "";
    }
  };
  const expectValue = (file, label, actual, expected) => {
    if (actual !== expected) {
      errors.push(`${file}: ${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  };

  const pkg = parseJson(read("package.json"), "package.json", errors);
  const version = typeof pkg?.version === "string" ? pkg.version : null;
  if (!version || !SEMVER.test(version)) {
    errors.push(`package.json: version must be a stable semver string, found ${JSON.stringify(version)}`);
  }
  if (!version) return errors;

  const lock = parseJson(read("package-lock.json"), "package-lock.json", errors);
  expectValue("package-lock.json", "root version", lock?.version, version);
  expectValue("package-lock.json", 'packages[""].version', lock?.packages?.[""]?.version, version);

  const site = read("site/index.html");
  const expectedDownloadUrl = `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}/Kirea-Studio-Setup-${version}-win-x64.exe`;
  const downloadUrls = Array.from(
    site.matchAll(/https:\/\/github\.com\/kaelharris\/kirea-studio\/releases\/download\/v[^/"'\s]+\/[^"'\s<>]+/g),
    (match) => match[0]
  );
  if (downloadUrls.length === 0) {
    errors.push("site/index.html: no versioned installer download URLs found");
  }
  for (const url of downloadUrls) {
    expectValue("site/index.html", "installer download URL", url, expectedDownloadUrl);
  }
  if (!site.includes(`Kirea Studio v${version}`)) {
    errors.push(`site/index.html: displayed "Kirea Studio v${version}" label not found`);
  }

  const jsonLdBlocks = Array.from(
    site.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1]
  );
  if (jsonLdBlocks.length === 0) {
    errors.push("site/index.html: no application/ld+json block found");
  }
  const softwareApplications = jsonLdBlocks.flatMap((block, index) => {
    const parsed = parseJson(block, `site/index.html JSON-LD block ${index + 1}`, errors);
    return collectSoftwareApplications(parsed);
  });
  if (softwareApplications.length !== 1) {
    errors.push(
      `site/index.html: expected one SoftwareApplication JSON-LD object, found ${softwareApplications.length}`
    );
  }
  for (const app of softwareApplications) {
    expectValue("site/index.html", "JSON-LD softwareVersion", app.softwareVersion, version);
    expectValue("site/index.html", "JSON-LD downloadUrl", app.downloadUrl, expectedDownloadUrl);
  }

  const splash = read("src/splash.html");
  const splashEdition = splash.match(/<p\s+class=["']edition["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
  const splashVersion = splashEdition.match(/\bv(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
  expectValue("src/splash.html", "edition label version", splashVersion, version);

  const readme = read("README.md");
  const readmeHeading = readme.match(/^## Status — v(\d+\.\d+\.\d+)\s*$/m)?.[1] ?? null;
  expectValue("README.md", "current status heading version", readmeHeading, version);
  if (!readme.includes(`Version **${version}**`)) {
    errors.push(`README.md: current "Version **${version}**" status not found`);
  }
  const readmeDownloadVersions = Array.from(
    readme.matchAll(/Download Kirea Studio (\d+\.\d+\.\d+)/g),
    (match) => match[1]
  );
  if (readmeDownloadVersions.length === 0) {
    errors.push("README.md: no current download version label found");
  }
  for (const downloadVersion of readmeDownloadVersions) {
    expectValue("README.md", "download label version", downloadVersion, version);
  }

  const releaseNotes = read("RELEASE_NOTES.md");
  const releaseNotesHeading = releaseNotes.match(/^# Release Notes — Kirea Studio v(\d+\.\d+\.\d+)\s*$/m)?.[1] ?? null;
  expectValue("RELEASE_NOTES.md", "current release heading version", releaseNotesHeading, version);

  const changelog = read("CHANGELOG.md");
  const changelogHeading = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1] ?? null;
  expectValue("CHANGELOG.md", "latest changelog heading version", changelogHeading, version);

  const civitaiClient = read("src/main/civitai/civitai-client.ts");
  const userAgent = civitaiClient.match(
    /const\s+USER_AGENT\s*=\s*["']KireaStudio\/([^"']+) \(Windows Desktop\)["'];/
  )?.[1] ?? null;
  expectValue("src/main/civitai/civitai-client.ts", "CivitAI User-Agent version", userAgent, version);

  return errors;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const errors = verifyReleaseVersion();
  if (errors.length > 0) {
    console.error("Release version verification failed:");
    for (const error of errors) console.error(` - ${error}`);
    process.exitCode = 1;
  } else {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    console.log(`Release version verification passed for v${pkg.version}.`);
  }
}
