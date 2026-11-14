import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { CharacterStorage } from "../../src/main/characters/character-storage";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import {
  characterImg2ImgWorkflowId,
  characterReferenceDenoise,
  characterTextWorkflowId,
  composeCharacterPrompt,
  getCharacterCoverReference,
  getPrimaryCharacterReference,
  removeCharacterIdentityTokens,
  resolveCharacterReferencePlan,
} from "../../src/shared/character-utils";
import type {
  CharacterProfile,
  CharacterProfileInput,
  CharacterReference,
  ModelArchitecture,
} from "../../src/shared/types";

const tempDirs: string[] = [];
const openDbs: StudioDatabase[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-char-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeDb(): StudioRepository {
  const db = new StudioDatabase(":memory:");
  openDbs.push(db);
  return new StudioRepository(db);
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()!.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const NOW = "2026-11-11T10:00:00.000Z";

function characterInput(
  overrides: Partial<CharacterProfileInput> = {}
): CharacterProfileInput {
  return {
    name: "Aria",
    description: "Protagonist of the Kirea demo arc.",
    appearance: "silver hair, amber eyes",
    clothing: "black tailored coat",
    promptPrefix: "kirea_aria",
    negativePrompt: "extra characters",
    triggerWords: ["aria_character"],
    architecture: "sdxl",
    referenceMode: "img2img",
    referenceWeight: 0.75,
    tags: ["anime"],
    ...overrides,
  };
}

function makeReference(
  character: CharacterProfile,
  overrides: Partial<CharacterReference> = {}
): CharacterReference {
  return {
    id: "ref_fixture",
    characterId: character.id,
    role: "secondary",
    filePath: path.join("C:\\userData\\characters", character.id, "ref.png"),
    sourcePath: null,
    caption: "",
    weight: 1,
    position: 0,
    createdAt: NOW,
    ...overrides,
  };
}

describe("Character repository CRUD", () => {
  it("creates, lists, updates, and deletes characters", () => {
    const repo = makeDb();
    const saved = repo.saveCharacter(characterInput());
    expect(saved.id).toBeTruthy();
    expect(saved.name).toBe("Aria");
    expect(saved.architecture).toBe("sdxl");
    expect(saved.references).toEqual([]);

    const listed = repo.listCharacters();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(saved.id);

    const updated = repo.saveCharacter(
      characterInput({
        id: saved.id,
        name: "Aria Prime",
        favorite: true,
        referenceWeight: 0.4,
      })
    );
    expect(updated.name).toBe("Aria Prime");
    expect(updated.favorite).toBe(true);
    expect(updated.referenceWeight).toBe(0.4);
    expect(updated.createdAt).toBe(saved.createdAt);

    repo.markCharacterUsed(saved.id);
    repo.markCharacterUsed(saved.id);
    const used = repo.getCharacterById(saved.id);
    expect(used?.usageCount).toBe(2);
    expect(used?.lastUsedAt).toBeTruthy();

    expect(repo.deleteCharacter(saved.id)).toBe(true);
    expect(repo.listCharacters()).toEqual([]);
    expect(repo.deleteCharacter(saved.id)).toBe(false);
  });

  it("persists references in position order and refreshes updatedAt", () => {
    const repo = makeDb();
    const character = repo.saveCharacter(characterInput());

    const first = repo.addCharacterReference({
      characterId: character.id,
      filePath: "C:\\userData\\characters\\x\\a.png",
      role: "secondary",
    });
    const second = repo.addCharacterReference({
      characterId: character.id,
      filePath: "C:\\userData\\characters\\x\\b.png",
      role: "outfit",
      caption: "winter coat",
    });

    const reloaded = repo.getCharacterById(character.id)!;
    expect(reloaded.references.map((ref) => ref.id)).toEqual([first.id, second.id]);
    expect(reloaded.references[1]!.caption).toBe("winter coat");

    const updated = repo.updateCharacterReference(character.id, first.id, {
      caption: "front view",
      weight: 0.8,
    });
    expect(updated?.caption).toBe("front view");
    expect(updated?.weight).toBe(0.8);

    const removed = repo.removeCharacterReference(character.id, second.id);
    expect(removed?.id).toBe(second.id);
    expect(repo.getCharacterById(character.id)!.references).toHaveLength(1);
  });

  it("keeps exactly one primary reference by demoting the previous primary", () => {
    const repo = makeDb();
    const character = repo.saveCharacter(characterInput());

    const primary = repo.addCharacterReference({
      characterId: character.id,
      filePath: "C:\\userData\\characters\\x\\primary.png",
      role: "primary",
    });
    const outfit = repo.addCharacterReference({
      characterId: character.id,
      filePath: "C:\\userData\\characters\\x\\outfit.png",
      role: "outfit",
    });

    // Promote the outfit reference through the update path.
    repo.updateCharacterReference(character.id, outfit.id, { role: "primary" });

    const refs = repo.getCharacterById(character.id)!.references;
    const primaries = refs.filter((ref) => ref.role === "primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.id).toBe(outfit.id);
    expect(refs.find((ref) => ref.id === primary.id)!.role).toBe("secondary");

    // Promote the original primary again; it should win and the other demote.
    repo.updateCharacterReference(character.id, primary.id, { role: "primary" });
    const after = repo.getCharacterById(character.id)!.references;
    expect(after.filter((ref) => ref.role === "primary")).toHaveLength(1);
    expect(after.find((ref) => ref.id === primary.id)!.role).toBe("primary");
    expect(after.find((ref) => ref.id === outfit.id)!.role).toBe("secondary");
  });

  it("applies reference role updates from saveCharacter with one primary only", () => {
    const repo = makeDb();
    const character = repo.saveCharacter(characterInput());
    const a = repo.addCharacterReference({
      characterId: character.id,
      filePath: "C:\\userData\\characters\\x\\a.png",
      role: "secondary",
    });
    const b = repo.addCharacterReference({
      characterId: character.id,
      filePath: "C:\\userData\\characters\\x\\b.png",
      role: "secondary",
    });

    repo.saveCharacter(
      characterInput({
        id: character.id,
        references: [
          { id: a.id, role: "primary", caption: "hero" },
          { id: b.id, role: "primary", caption: "alt" },
        ],
      })
    );

    const refs = repo.getCharacterById(character.id)!.references;
    const primaries = refs.filter((ref) => ref.role === "primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.id).toBe(a.id);
    expect(primaries[0]!.caption).toBe("hero");
    expect(refs.find((ref) => ref.id === b.id)!.role).toBe("secondary");
  });

  it("cascades reference deletion with the character row", () => {
    const repo = makeDb();
    const db = openDbs[openDbs.length - 1]!;
    const character = repo.saveCharacter(characterInput());
    repo.addCharacterReference({
      characterId: character.id,
      filePath: "C:\\userData\\characters\\x\\a.png",
      role: "primary",
    });

    const count = db.db
      .prepare("SELECT COUNT(*) AS n FROM character_references WHERE character_id = ?")
      .get(character.id) as { n: number };
    expect(count.n).toBe(1);

    repo.deleteCharacter(character.id);
    const after = db.db
      .prepare("SELECT COUNT(*) AS n FROM character_references WHERE character_id = ?")
      .get(character.id) as { n: number };
    expect(after.n).toBe(0);
  });

  it("rejects references for unknown characters", () => {
    const repo = makeDb();
    expect(() =>
      repo.addCharacterReference({
        characterId: "missing",
        filePath: "C:\\userData\\characters\\missing\\a.png",
      })
    ).toThrow(/Unknown character/);
  });
});

describe("Character identity composition and execution plan", () => {
  const character: CharacterProfile = {
    id: "char_aria",
    name: "Aria",
    description: "",
    appearance: "silver hair, amber eyes",
    clothing: "black tailored coat",
    promptPrefix: "kirea_aria",
    negativePrompt: "",
    triggerWords: ["aria_character", "silver hair"],
    architecture: "sdxl",
    checkpointPath: null,
    checkpointName: null,
    loraRecipeId: null,
    referenceMode: "none",
    referenceWeight: 0.5,
    referenceStart: 0,
    referenceEnd: 1,
    tags: [],
    favorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    references: [],
  };

  const primary = makeReference(character, {
    id: "ref_primary",
    role: "primary",
    filePath: "C:\\userData\\characters\\char_aria\\primary.png",
  });

  it("prepends identity tokens without duplicating prompt segments", () => {
    const prompt = composeCharacterPrompt(
      character,
      "portrait, kirea_aria, cinematic lighting"
    );
    expect(prompt.startsWith("silver hair, amber eyes, black tailored coat")).toBe(
      true
    );
    expect(prompt.toLowerCase().split("kirea_aria").length - 1).toBe(1);
    expect(prompt).toContain("cinematic lighting");
  });

  it("removes exactly the identity tokens when clearing a character", () => {
    const prompt = composeCharacterPrompt(
      character,
      "portrait, cinematic lighting"
    );
    const cleared = removeCharacterIdentityTokens(prompt, character);
    expect(cleared).toBe("portrait, cinematic lighting");
  });

  it("maps identity weight to clamped img2img denoise", () => {
    expect(characterReferenceDenoise(0)).toBe(0.75);
    expect(characterReferenceDenoise(0.5)).toBe(0.55);
    expect(characterReferenceDenoise(1)).toBe(0.35);
    expect(characterReferenceDenoise(-1)).toBe(0.75);
    expect(characterReferenceDenoise(4)).toBe(0.35);
  });

  it("selects the stock text workflow for each architecture", () => {
    expect(characterTextWorkflowId("sd15")).toBe("t2i_sd15_base");
    expect(characterTextWorkflowId("sdxl")).toBe("t2i_sdxl_base");
    expect(characterTextWorkflowId("illustrious")).toBe("t2i_sdxl_base");
    expect(characterTextWorkflowId("z_image")).toBe("t2i_z_image_turbo");
  });

  it("selects stock img2img only for SD15/SDXL-family architectures", () => {
    const mapping: Array<[ModelArchitecture, string | null]> = [
      ["sd15", "i2i_sd15_base"],
      ["sdxl", "i2i_sdxl_base"],
      ["illustrious", "i2i_sdxl_base"],
      ["pony", "i2i_sdxl_base"],
      ["unknown", "i2i_sdxl_base"],
      ["z_image", null],
      ["flux", null],
      ["anima", "i2i_anima_base"],
      ["ltx_video", null],
    ];
    for (const [arch, expected] of mapping) {
      expect(characterImg2ImgWorkflowId(arch)).toBe(expected);
    }
  });

  it("stays text-only when reference mode is none or no primary exists", () => {
    const textOnly = resolveCharacterReferencePlan(character, "sdxl");
    expect(textOnly.active).toBe(false);
    expect(textOnly.reason).toBe("mode_none");

    const img2imgWithoutPrimary = resolveCharacterReferencePlan(
      { ...character, referenceMode: "img2img" },
      "sdxl"
    );
    expect(img2imgWithoutPrimary.active).toBe(false);
    expect(img2imgWithoutPrimary.reason).toBe("missing_primary");

    const withPrimary = { ...character, referenceMode: "img2img" as const, references: [primary] };
    const active = resolveCharacterReferencePlan(withPrimary, "sdxl");
    expect(active.active).toBe(true);
    expect(active.workflowId).toBe("i2i_sdxl_base");
    expect(active.denoise).toBe(0.55);
    expect(active.reference?.id).toBe("ref_primary");
  });

  it("falls back to text identity for architectures without stock img2img", () => {
    const plan = resolveCharacterReferencePlan(
      { ...character, referenceMode: "img2img", references: [primary] },
      "flux"
    );
    expect(plan.active).toBe(false);
    expect(plan.reason).toBe("unsupported_architecture");
    expect(plan.workflowId).toBeNull();
  });

  it("prioritizes primary references for covers", () => {
    const outfit = makeReference(character, { id: "ref_outfit", role: "outfit" });
    expect(getPrimaryCharacterReference({ references: [outfit, primary] })?.id).toBe(
      "ref_primary"
    );
    expect(getCharacterCoverReference({ references: [outfit] })?.id).toBe(
      "ref_outfit"
    );
  });
});

describe("Character storage path guards", () => {
  async function writePng(dir: string): Promise<string> {
    const file = path.join(dir, "source.png");
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 120, g: 80, b: 200 },
      },
    })
      .png()
      .toFile(file);
    return file;
  }

  it("imports references into the character directory with a thumbnail", async () => {
    const root = makeTempDir();
    const charsRoot = path.join(root, "characters");
    const storage = new CharacterStorage(charsRoot);
    const source = await writePng(root);

    const imported = await storage.importFromFile("char_aria", source);
    expect(imported.filePath.startsWith(path.join(charsRoot, "char_aria"))).toBe(true);
    expect(fs.existsSync(imported.filePath)).toBe(true);
    expect(fs.existsSync(imported.filePath.replace(/\.png$/, ".thumb.webp"))).toBe(
      true
    );

    const dataUrl = await storage.readPreviewDataUrl(imported.filePath);
    expect(dataUrl?.startsWith("data:image/webp;base64,")).toBe(true);

    expect(await storage.removeReferenceFile(imported.filePath)).toBe(true);
    expect(fs.existsSync(imported.filePath)).toBe(false);
  });

  it("refuses invalid ids and unsupported extensions", async () => {
    const root = makeTempDir();
    const storage = new CharacterStorage(path.join(root, "characters"));
    expect(() => storage.characterDir("../escape")).toThrow(/Invalid character/);

    const textFile = path.join(root, "note.txt");
    fs.writeFileSync(textFile, "not an image");
    await expect(storage.importFromFile("char_aria", textFile)).rejects.toThrow(
      /PNG, JPEG, or WebP/
    );
  });

  it("never reads or deletes files outside the character root", async () => {
    const root = makeTempDir();
    const charsRoot = path.join(root, "characters");
    const storage = new CharacterStorage(charsRoot);
    const outside = await writePng(root);

    expect(await storage.readPreviewDataUrl(outside)).toBeNull();
    expect(await storage.removeReferenceFile(outside)).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("removes a character folder recursively", async () => {
    const root = makeTempDir();
    const charsRoot = path.join(root, "characters");
    const storage = new CharacterStorage(charsRoot);
    const source = await writePng(root);
    const imported = await storage.importFromFile("char_aria", source);

    await storage.removeCharacterFiles("char_aria");
    expect(fs.existsSync(path.dirname(imported.filePath))).toBe(false);
  });
});
