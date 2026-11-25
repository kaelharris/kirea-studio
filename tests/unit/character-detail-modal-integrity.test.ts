import { describe, expect, it, vi } from "vitest";
import { CharacterProfilePatchSchema } from "../../src/main/ipc/schemas";
import {
  appendTrainingLogLine,
  buildCharacterKnowledgeInput,
  loadCharacterWorkspace,
  shouldHandleTrainingEvent,
} from "../../src/renderer/components/characters/CharacterDetailModal";
import type {
  CharacterAdapter,
  CharacterKnowledge,
  CharacterOutfit,
  CharacterTrainingJob,
} from "../../src/shared/types";

const knowledge: CharacterKnowledge = {
  personality: "Curious",
  speechStyle: "Friendly",
  background: "Archivist",
  history: "Studied the northern ruins",
  relationships: [],
  motivations: "Preserve forgotten stories",
  likes: ["maps"],
  dislikes: ["dust"],
  rules: ["Record every discovery"],
  worldbuilding: "A city of moving libraries",
  dialogueExamples: [],
};

describe("CharacterDetailModal data integrity", () => {
  it("builds a narrow knowledge patch accepted by the strict save schema", () => {
    const input = buildCharacterKnowledgeInput("char_aria", knowledge);

    expect(input).toEqual({ id: "char_aria", knowledge });
    expect(Object.keys(input).sort()).toEqual(["id", "knowledge"]);
    expect(CharacterProfilePatchSchema.parse(input)).toEqual(input);
  });

  it("ignores stale workspace loads after the requested character changes", async () => {
    let currentCharacterId = "char_aria";
    let resolveOutfits!: (value: CharacterOutfit[]) => void;
    let resolveAdapters!: (value: CharacterAdapter[]) => void;
    let resolveJobs!: (value: CharacterTrainingJob[]) => void;
    const api = {
      listCharacterOutfits: vi.fn(
        () => new Promise<CharacterOutfit[]>((resolve) => { resolveOutfits = resolve; })
      ),
      listCharacterAdapters: vi.fn(
        () => new Promise<CharacterAdapter[]>((resolve) => { resolveAdapters = resolve; })
      ),
      listCharacterTrainingJobs: vi.fn(
        () => new Promise<CharacterTrainingJob[]>((resolve) => { resolveJobs = resolve; })
      ),
    };
    const apply = vi.fn();

    const loading = loadCharacterWorkspace(
      "char_aria",
      api,
      () => currentCharacterId === "char_aria",
      apply
    );
    currentCharacterId = "char_ren";
    resolveOutfits([]);
    resolveAdapters([]);
    resolveJobs([]);
    await loading;

    expect(apply).not.toHaveBeenCalled();

    currentCharacterId = "char_aria";
    const currentLoading = loadCharacterWorkspace(
      "char_aria",
      api,
      () => currentCharacterId === "char_aria",
      apply
    );
    resolveOutfits([]);
    resolveAdapters([]);
    resolveJobs([]);
    await currentLoading;

    expect(apply).toHaveBeenCalledWith({ outfits: [], adapters: [], jobs: [] });
  });

  it("accepts telemetry only for the active job and character", () => {
    const matches = shouldHandleTrainingEvent;

    expect(matches({ jobId: "job_aria" }, "job_aria", "char_aria")).toBe(true);
    expect(matches({ jobId: "job_ren" }, "job_aria", "char_aria")).toBe(false);
    expect(matches({}, "job_aria", "char_aria")).toBe(false);
    expect(matches({ jobId: "job_aria" }, null, "char_aria")).toBe(false);
    expect(matches({ trainingId: "job_aria" }, "job_aria", "char_aria")).toBe(true);
    expect(matches({ trainingId: "job_ren" }, "job_aria", "char_aria")).toBe(false);
    expect(matches({ jobId: "job_aria", characterId: "char_ren" }, "job_aria", "char_aria")).toBe(false);
    expect(matches({ jobId: "job_aria", characterId: "char_aria" }, "job_aria", "char_aria")).toBe(true);
  });

  it("caps retained training logs at 1000 lines and keeps the newest entries", () => {
    let lines: string[] = [];
    for (let index = 0; index < 1005; index += 1) {
      lines = appendTrainingLogLine(lines, `line ${index}`);
    }

    expect(lines).toHaveLength(1000);
    expect(lines[0]).toBe("line 5");
    expect(lines[999]).toBe("line 1004");
  });
});
