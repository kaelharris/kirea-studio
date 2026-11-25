import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { StudioDatabase } from "../../src/main/db/database";
import { CharactersRepository } from "../../src/main/db/repos/characters-repo";
import type { CharacterAdapter, CharacterProfile } from "../../src/shared/types";

describe("KIREA Adapter Registration & Persistence Lifecycle", () => {
  const tempDir = path.join(__dirname, "../../temp/adapter_test_db");
  const dbPath = path.join(tempDir, "test_persistence.db");

  it("locates, registers, and persists the smoke-test LoRA adapter across studio restarts", () => {
    fs.mkdirSync(tempDir, { recursive: true });
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    // --- SESSION 1: Studio running, registers adapter ---
    let db1 = new StudioDatabase(dbPath);
    let repo1 = new CharactersRepository(db1);

    // Create Aurelia character profile if not exists
    const aurelia: CharacterProfile = repo1.saveCharacter({
      id: "char_aurelia_verification",
      name: "Aurelia",
      description: "Character DNA verification profile",
      version: 1,
      triggerWords: ["aurelia_char"],
      references: [],
      tags: ["anime", "character-dna"],
    } as any);

    expect(aurelia.id).toBe("char_aurelia_verification");

    const loraPath = path.join(tempDir, "smoke_adapter.safetensors");
    const header = Buffer.from(
      JSON.stringify({
        "lora_unet.smoke": { dtype: "F32", shape: [1], data_offsets: [0, 4] },
      })
    );
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(header.length));
    fs.writeFileSync(loraPath, Buffer.concat([length, header, Buffer.alloc(4)]));

    const adapterInput = {
      id: "adapter_smoke_test_v1",
      characterId: aurelia.id,
      baseModelFamily: "illustrious" as const,
      checkpointPath: "models/Animixy.safetensors",
      checkpointName: "Animixy²",
      triggerToken: "smoke_test_token",
      fileLocation: loraPath,
      rank: 16,
      alpha: 16,
      recommendedStrength: 0.85,
      status: "trained" as const,
      trainingConfig: {
        baseModelFamily: "illustrious",
        baseCheckpointPath: "Animixy².safetensors",
        triggerToken: "smoke_test_token",
        rank: 16,
        alpha: 16,
        learningRate: 1e-4,
        epochs: 1,
        batchSize: 1,
        resolution: 1024,
      },
      validationImages: [],
    };

    const savedAdapter = repo1.saveAdapter(adapterInput);
    expect(savedAdapter.id).toBe("adapter_smoke_test_v1");
    expect(savedAdapter.fileLocation).toBe(loraPath);
    expect(savedAdapter.status).toBe("trained");

    // Close session 1 (simulate studio process shutdown)
    db1.close();

    // --- SESSION 2: Studio restarts from disk ---
    let db2 = new StudioDatabase(dbPath);
    let repo2 = new CharactersRepository(db2);

    const reloadedCharacter = repo2.getCharacterById("char_aurelia_verification");
    expect(reloadedCharacter).not.toBeNull();
    expect(reloadedCharacter?.adapters).toBeDefined();
    expect(reloadedCharacter!.adapters!.length).toBe(1);

    const persistedAdapter = reloadedCharacter!.adapters![0]!;
    expect(persistedAdapter.id).toBe("adapter_smoke_test_v1");
    expect(persistedAdapter.characterId).toBe("char_aurelia_verification");
    expect(persistedAdapter.triggerToken).toBe("smoke_test_token");
    expect(persistedAdapter.fileLocation).toBe(loraPath);
    expect(persistedAdapter.rank).toBe(16);
    expect(persistedAdapter.alpha).toBe(16);
    expect(persistedAdapter.recommendedStrength).toBe(0.85);
    expect(persistedAdapter.status).toBe("trained");
    expect(persistedAdapter.checkpointName).toBe("Animixy²");
    expect(fs.existsSync(persistedAdapter.fileLocation)).toBe(true);

    db2.close();

    // Clean up temp DB
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(loraPath);
      fs.rmdirSync(tempDir);
    } catch {}
  });
});
