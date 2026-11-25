import { afterEach, describe, expect, it } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { CharactersRepository } from "../../src/main/db/repos/characters-repo";
import type {
  CharacterIdentityCore,
  CharacterKnowledge,
  CharacterProfile,
} from "../../src/shared/types";

const openDbs: StudioDatabase[] = [];

function makeRepo(): CharactersRepository {
  const db = new StudioDatabase(":memory:");
  openDbs.push(db);
  return new CharactersRepository(db);
}

const dna: CharacterIdentityCore = {
  triggerToken: "kirea_aria",
  gender: "Female",
  ageCategory: "Adult",
  species: "Human",
  archetype: "Ronin",
  hairColor: "silver",
  hairStyle: "long braid",
  eyeColor: "amber",
  skinTone: "pale",
  facialCharacteristics: "sharp features",
  distinctiveFeatures: ["scar over left eyebrow"],
  bodyCharacteristics: "athletic",
  signatureAccessories: ["red scarf"],
  canonicalDescription: "A silver-haired ronin with amber eyes.",
  fixedTraits: ["silver hair", "amber eyes"],
  variableTraits: ["travel cloak"],
  preferredStyle: "anime watercolor",
  negativeConstraints: "glasses, blue hair",
  dnaLocked: true,
};

const knowledge: CharacterKnowledge = {
  personality: "Stoic and loyal",
  speechStyle: "Concise, formal",
  background: "Former imperial guard",
  history: "Defected after the northern war",
  relationships: [{ target: "Ren", relation: "mentor", notes: "Trusted ally" }],
  motivations: "Protect the northern villages",
  likes: ["tea", "rain"],
  dislikes: ["tyrants", "cold steel"],
  rules: ["Never abandon a ally", "Keep promises"],
  worldbuilding: "The northern reaches are ruled by competing clans",
  dialogueExamples: [{ context: "Before battle", quote: "Stand with me." }],
};

function createCharacter(repo: CharactersRepository): CharacterProfile {
  return repo.saveCharacter({
    name: "Aria",
    description: "Wandering swordswoman",
    appearance: "silver hair, amber eyes, red scarf",
    clothing: "weathered travel cloak",
    promptPrefix: "portrait of Aria",
    negativePrompt: "extra fingers",
    triggerWords: ["kirea_aria", "aria_character"],
    architecture: "sdxl",
    checkpointPath: "models/aria.safetensors",
    checkpointName: "Aria Base",
    loraRecipeId: null,
    referenceMode: "ipadapter",
    referenceWeight: 0.42,
    referenceStart: 0.2,
    referenceEnd: 0.9,
    tags: ["anime", "ronin"],
    favorite: true,
    dna,
    knowledge,
    activeAdapterId: "adapter_aria",
    activeOutfitId: "outfit_aria",
  });
}

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()!.close();
});

describe("Character repository patch integrity", () => {
  it("preserves base, DNA, knowledge, references, and usage data on an id/name-only save", () => {
    const repo = makeRepo();
    const original = createCharacter(repo);
    const primary = repo.addCharacterReference({
      characterId: original.id,
      filePath: "references/aria-primary.png",
      role: "primary",
      caption: "Front portrait",
    });
    repo.markCharacterUsed(original.id);
    const before = repo.getCharacterById(original.id)!;

    const updated = repo.saveCharacter({ id: original.id, name: "Aria Prime" });

    expect(updated).toMatchObject({
      id: original.id,
      name: "Aria Prime",
      description: before.description,
      appearance: before.appearance,
      clothing: before.clothing,
      promptPrefix: before.promptPrefix,
      negativePrompt: before.negativePrompt,
      triggerWords: before.triggerWords,
      architecture: before.architecture,
      checkpointPath: before.checkpointPath,
      checkpointName: before.checkpointName,
      loraRecipeId: before.loraRecipeId,
      referenceMode: before.referenceMode,
      referenceWeight: before.referenceWeight,
      referenceStart: before.referenceStart,
      referenceEnd: before.referenceEnd,
      tags: before.tags,
      favorite: before.favorite,
      usageCount: 1,
      lastUsedAt: before.lastUsedAt,
      createdAt: before.createdAt,
      dna: before.dna,
      knowledge: before.knowledge,
      activeAdapterId: "adapter_aria",
      activeOutfitId: "outfit_aria",
    });
    expect(updated.references).toEqual([primary]);
  });

  it("merges partial nested DNA and knowledge without touching omitted references", () => {
    const repo = makeRepo();
    const original = createCharacter(repo);
    const primary = repo.addCharacterReference({
      characterId: original.id,
      filePath: "references/aria-primary.png",
      role: "primary",
      caption: "Original caption",
      weight: 0.8,
    });
    repo.addCharacterReference({
      characterId: original.id,
      filePath: "references/aria-secondary.png",
      role: "secondary",
      caption: "Secondary caption",
    });

    const updated = repo.saveCharacter({
      id: original.id,
      name: original.name,
      dna: { hairColor: "blue" },
      knowledge: { personality: "Warm and outspoken" },
    });

    expect(updated.dna).toEqual({ ...original.dna, hairColor: "blue" });
    expect(updated.knowledge).toEqual({
      ...original.knowledge,
      personality: "Warm and outspoken",
    });
    expect(updated.references).toEqual([
      primary,
      expect.objectContaining({
        role: "secondary",
        caption: "Secondary caption",
      }),
    ]);
  });

  it("persists explicit empty arrays, empty strings, false flags, and null checkpoints", () => {
    const repo = makeRepo();
    const original = createCharacter(repo);

    const updated = repo.saveCharacter({
      id: original.id,
      name: original.name,
      description: "",
      appearance: "silver hair, amber eyes, red scarf",
      clothing: "",
      promptPrefix: "",
      negativePrompt: "extra fingers",
      triggerWords: [],
      tags: [],
      favorite: false,
      checkpointPath: null,
      checkpointName: "",
      loraRecipeId: null,
      referenceWeight: 0,
      activeAdapterId: "",
      activeOutfitId: "",
      dna: {
        triggerToken: "",
        gender: "",
        archetype: "",
        hairColor: "",
        facialCharacteristics: "",
        canonicalDescription: "",
        distinctiveFeatures: [],
        signatureAccessories: [],
        fixedTraits: [],
        variableTraits: [],
        preferredStyle: "",
        negativeConstraints: "",
        dnaLocked: false,
      },
      knowledge: {
        personality: "",
        speechStyle: "",
        relationships: [],
        likes: [],
        dislikes: [],
        rules: [],
        dialogueExamples: [],
      },
    });

    expect(updated).toMatchObject({
      description: "",
      appearance: "silver hair, amber eyes, red scarf",
      clothing: "",
      promptPrefix: "",
      negativePrompt: "extra fingers",
      triggerWords: [],
      tags: [],
      favorite: false,
      checkpointPath: null,
      checkpointName: "",
      loraRecipeId: null,
      referenceWeight: 0,
      activeAdapterId: "",
      activeOutfitId: "",
      dna: {
        triggerToken: "",
        gender: "",
        archetype: "",
        hairColor: "",
        facialCharacteristics: "",
        canonicalDescription: "",
        distinctiveFeatures: [],
        signatureAccessories: [],
        fixedTraits: [],
        variableTraits: [],
        preferredStyle: "",
        negativeConstraints: "",
        dnaLocked: false,
      },
      knowledge: {
        personality: "",
        speechStyle: "",
        relationships: [],
        likes: [],
        dislikes: [],
        rules: [],
        dialogueExamples: [],
      },
    });
  });

  it("clears active adapter and outfit only when explicit null is supplied", () => {
    const repo = makeRepo();
    const original = createCharacter(repo);

    const preserved = repo.saveCharacter({ id: original.id, name: original.name });
    expect(preserved.activeAdapterId).toBe("adapter_aria");
    expect(preserved.activeOutfitId).toBe("outfit_aria");

    const cleared = repo.saveCharacter({
      id: original.id,
      name: original.name,
      activeAdapterId: null,
      activeOutfitId: null,
    });
    expect(cleared.activeAdapterId).toBeNull();
    expect(cleared.activeOutfitId).toBeNull();
  });
});

describe("Character outfit and adapter ownership", () => {
  it("rejects cross-character outfit updates and deletes", () => {
    const repo = makeRepo();
    const owner = createCharacter(repo);
    const other = repo.saveCharacter({ name: "Other" });
    const outfit = repo.saveOutfit({
      id: "outfit_aria",
      characterId: owner.id,
      name: "Travel Cloak",
      description: "Original description",
      promptTokens: ["red scarf"],
      isDefault: true,
    });
    const otherDefault = repo.saveOutfit({
      id: "outfit_other",
      characterId: other.id,
      name: "Other Default",
      promptTokens: ["other token"],
      isDefault: true,
    });

    expect(() =>
      repo.saveOutfit({
        id: outfit.id,
        characterId: other.id,
        name: "Stolen Outfit",
        promptTokens: ["stolen"],
        isDefault: true,
      })
    ).toThrow();

    expect(repo.listOutfits(owner.id)).toEqual([outfit]);
    expect(repo.listOutfits(other.id)).toEqual([otherDefault]);
    expect(repo.deleteOutfit(outfit.id, other.id)).toBe(false);
    expect(repo.listOutfits(owner.id)).toEqual([outfit]);
    expect(repo.deleteOutfit(outfit.id, owner.id)).toBe(true);
    expect(repo.listOutfits(owner.id)).toEqual([]);
  });

  it("rejects cross-character adapter updates and deletes", () => {
    const repo = makeRepo();
    const owner = createCharacter(repo);
    const other = repo.saveCharacter({ name: "Other" });
    const adapter = repo.saveAdapter({
      id: "adapter_aria",
      characterId: owner.id,
      baseModelFamily: "sdxl",
      triggerToken: "kirea_aria",
      fileLocation: "adapters/aria.safetensors",
      rank: 16,
      alpha: 16,
      recommendedStrength: 0.85,
      status: "trained",
    });

    expect(() =>
      repo.saveAdapter({
        id: adapter.id,
        characterId: other.id,
        baseModelFamily: "illustrious",
        triggerToken: "stolen_token",
        fileLocation: "adapters/stolen.safetensors",
      })
    ).toThrow();

    expect(repo.listAdapters(owner.id)).toEqual([adapter]);
    expect(repo.listAdapters(other.id)).toEqual([]);
    expect(repo.deleteAdapter(adapter.id, other.id)).toBe(false);
    expect(repo.listAdapters(owner.id)).toEqual([adapter]);

    const updated = repo.saveAdapter({
      id: adapter.id,
      characterId: owner.id,
      baseModelFamily: "sdxl",
      triggerToken: "kirea_aria_v2",
      fileLocation: "adapters/aria-v2.safetensors",
    });
    expect(updated.triggerToken).toBe("kirea_aria_v2");
    expect(repo.deleteAdapter(adapter.id, owner.id)).toBe(true);
    expect(repo.listAdapters(owner.id)).toEqual([]);
  });
});
