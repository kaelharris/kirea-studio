import { describe, expect, it } from "vitest";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { WORKFLOW_TEMPLATES } from "../../src/main/comfy/workflow-registry";
import {
  buildStoryScenePlan,
  mergePromptSegments,
  resolveStorySceneCastIds,
  type StoryPlanDefaults,
} from "../../src/shared/story-utils";
import type {
  CharacterProfile,
  CharacterReferenceMode,
  GeneratedImageRecord,
  GenerationJob,
  LoraRecipe,
  ModelRecord,
  Story,
  StoryScene,
} from "../../src/shared/types";

const NOW = "2026-11-11T10:00:00.000Z";

const PLAN_DEFAULTS: StoryPlanDefaults = {
  width: 1024,
  height: 1024,
  steps: 24,
  cfg: 6.5,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  aspectRatio: "1:1",
  outputFormat: "png",
  performanceProfile: "balanced",
};

function makeCharacter(
  overrides: Partial<CharacterProfile> = {}
): CharacterProfile {
  return {
    id: "char_mira",
    name: "Mira",
    description: "Lantern keeper",
    appearance: "silver hair",
    clothing: "navy coat",
    promptPrefix: "portrait of mira",
    negativePrompt: "extra limbs",
    triggerWords: ["mira_style"],
    architecture: "sdxl",
    checkpointPath: "SDXL/base.safetensors",
    checkpointName: "base",
    loraRecipeId: null,
    referenceMode: "none",
    referenceWeight: 0.75,
    referenceStart: 0,
    referenceEnd: 1,
    tags: [],
    favorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    references: [],
    ...overrides,
  };
}

function makeCheckpointModel(
  relativePath = "SDXL/base.safetensors",
  architecture: ModelRecord["architecture"] = "sdxl"
): ModelRecord {
  return {
    id: `model_${architecture}`,
    name: relativePath.split("/").pop() ?? relativePath,
    relativePath,
    filePath: `C:\\Comfy\\models\\checkpoints\\${relativePath.replace(/\//g, "\\")}`,
    category: "checkpoint",
    architecture,
    sizeBytes: 1024,
    sha256: null,
    sourceRoot: "C:\\Comfy\\models\\checkpoints",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: NOW,
  };
}

function makeRecipe(overrides: Partial<LoraRecipe> = {}): LoraRecipe {
  return {
    id: "recipe_line",
    name: "Line Stack",
    description: "",
    mode: "txt2img",
    workflowId: null,
    architecture: "sdxl",
    checkpointPath: null,
    checkpointName: null,
    basePrompt: "ink line, rim light",
    negativePrompt: "blurry",
    settings: {
      aspectRatio: "3:4",
      steps: 30,
      cfg: 5.5,
      sampler: "euler",
      scheduler: "normal",
      batchCount: 2,
      denoise: 0.6,
    },
    coverImagePath: null,
    tags: [],
    favorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        position: 0,
        loraPath: "C:\\models\\loras\\line.safetensors",
        loraName: "line",
        architecture: "sdxl",
        strengthModel: 0.9,
        strengthClip: 0.8,
        enabled: true,
        triggerWords: [],
      },
      {
        position: 1,
        loraPath: "C:\\models\\loras\\shadow.safetensors",
        loraName: "shadow",
        architecture: "sdxl",
        strengthModel: 0.5,
        strengthClip: 0.5,
        enabled: false,
        triggerWords: [],
      },
    ],
    ...overrides,
  };
}

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "story_lantern",
    title: "The Lantern Keeper",
    logline: "A keeper walks the cliff path at dusk.",
    stylePrompt: "soft teal grade",
    negativePrompt: "watermark",
    defaultCharacterId: null,
    defaultCheckpointPath: null,
    defaultLoraRecipeId: null,
    coverSceneId: null,
    status: "draft",
    tags: [],
    favorite: false,
    createdAt: NOW,
    updatedAt: NOW,
    cast: [],
    scenes: [],
    ...overrides,
  };
}

function makeScene(overrides: Partial<StoryScene> = {}): StoryScene {
  return {
    id: "scene_1",
    storyId: "story_lantern",
    position: 0,
    title: "Cliff walk",
    synopsis: "",
    prompt: "standing on the cliff walk",
    negativePrompt: "lowres",
    checkpointPath: null,
    loraRecipeId: null,
    aspectRatio: null,
    width: null,
    height: null,
    steps: null,
    cfg: null,
    sampler: null,
    scheduler: null,
    seed: 123,
    denoise: null,
    referenceModeOverride: null,
    batchCount: 1,
    status: "draft",
    lastJobId: null,
    selectedImageId: null,
    createdAt: NOW,
    updatedAt: NOW,
    cast: [],
    ...overrides,
  };
}

function makeReferenceMode(
  mode: CharacterReferenceMode,
  references = [
    {
      id: "ref_primary",
      characterId: "char_mira",
      role: "primary" as const,
      filePath: "C:\\Kirea\\characters\\char_mira\\primary.png",
      sourcePath: null,
      caption: "",
      weight: 0.8,
      position: 0,
      createdAt: NOW,
    },
  ]
): CharacterProfile {
  return makeCharacter({ referenceMode: mode, references });
}

describe("Story planning", () => {
  it("prefers scene cast over story cast over default character", () => {
    const story = makeStory({
      cast: [
        { characterId: "char_mira", position: 0, storyRole: "lead" },
        { characterId: "char_ren", position: 1, storyRole: "supporting" },
      ],
      defaultCharacterId: "char_default",
    });
    const scene = makeScene({
      cast: [{ characterId: "char_scene", position: 0, roleHint: "crowd" }],
    });
    expect(resolveStorySceneCastIds(story, scene)).toEqual(["char_scene"]);
    expect(resolveStorySceneCastIds(story, makeScene())).toEqual([
      "char_mira",
      "char_ren",
    ]);
    expect(
      resolveStorySceneCastIds(
        makeStory({ cast: [], defaultCharacterId: "char_default" }),
        makeScene()
      )
    ).toEqual(["char_default"]);
  });

  it("merges prompts without duplicating segments", () => {
    expect(
      mergePromptSegments("soft light, rain", null, "rain, wet stone", "SOFT light")
    ).toBe("soft light, rain, wet stone");
  });

  it("inherits checkpoint, LoRA recipe settings, and cast tokens", () => {
    const lead = makeCharacter({ loraRecipeId: "recipe_line" });
    const support = makeCharacter({
      id: "char_ren",
      name: "Ren",
      promptPrefix: "young courier",
      appearance: "cropped hair",
      clothing: "leather satchel",
      triggerWords: ["ren_style"],
      negativePrompt: "bad hands",
      checkpointPath: null,
    });
    const story = makeStory({
      cast: [
        { characterId: lead.id, position: 0, storyRole: "lead" },
        { characterId: support.id, position: 1, storyRole: "supporting" },
      ],
    });

    const plan = buildStoryScenePlan({
      story,
      scene: makeScene(),
      characters: [lead, support],
      recipes: [makeRecipe()],
      models: [makeCheckpointModel()],
      workflows: WORKFLOW_TEMPLATES,
      defaults: PLAN_DEFAULTS,
      referenceFileExists: () => false,
    });

    expect(plan.checkpoint).toBe("SDXL/base.safetensors");
    expect(plan.architecture).toBe("sdxl");
    expect(plan.characterId).toBe("char_mira");
    expect(plan.loraRecipeId).toBe("recipe_line");
    expect(plan.loras).toHaveLength(1);
    expect(plan.loras[0]?.name).toBe("C:\\models\\loras\\line.safetensors");
    expect(plan.steps).toBe(30);
    expect(plan.cfg).toBe(5.5);
    expect(plan.sampler).toBe("euler");
    expect(plan.aspectRatio).toBe("3:4");
    expect(plan.batchCount).toBe(2);
    expect(plan.seed).toBe(123);
    expect(plan.randomSeed).toBe(false);
    expect(plan.mode).toBe("txt2img");
    expect(plan.workflowId).toBe("t2i_sdxl_base");

    for (const token of [
      "soft teal grade",
      "ink line",
      "standing on the cliff walk",
      "portrait of mira",
      "silver hair",
      "navy coat",
      "mira_style",
      "young courier",
      "cropped hair",
      "leather satchel",
      "ren_style",
    ]) {
      expect(plan.prompt).toContain(token);
    }
    for (const token of ["watermark", "blurry", "lowres", "extra limbs", "bad hands"]) {
      expect(plan.negativePrompt).toContain(token);
    }
  });

  it("activates stock img2img identity only for the lead with a primary reference", () => {
    const lead = makeReferenceMode("img2img");
    const story = makeStory({
      cast: [{ characterId: lead.id, position: 0, storyRole: "lead" }],
    });

    const active = buildStoryScenePlan({
      story,
      scene: makeScene(),
      characters: [lead],
      recipes: [],
      models: [makeCheckpointModel()],
      workflows: WORKFLOW_TEMPLATES,
      defaults: PLAN_DEFAULTS,
      referenceFileExists: () => true,
    });
    expect(active.mode).toBe("img2img");
    expect(active.workflowId).toBe("i2i_sdxl_base");
    expect(active.referenceActive).toBe(true);
    expect(active.inputImagePath).toBe(lead.references[0]?.filePath);
    expect(active.denoise).toBeCloseTo(0.45, 2);

    const missingFile = buildStoryScenePlan({
      story,
      scene: makeScene(),
      characters: [lead],
      recipes: [],
      models: [makeCheckpointModel()],
      workflows: WORKFLOW_TEMPLATES,
      defaults: PLAN_DEFAULTS,
      referenceFileExists: () => false,
    });
    expect(missingFile.mode).toBe("txt2img");
    expect(missingFile.workflowId).toBe("t2i_sdxl_base");
    expect(missingFile.referenceActive).toBe(false);
    expect(missingFile.issues.join(" ")).toContain("missing on disk");

    const overridden = buildStoryScenePlan({
      story,
      scene: makeScene({ referenceModeOverride: "none" }),
      characters: [lead],
      recipes: [],
      models: [makeCheckpointModel()],
      workflows: WORKFLOW_TEMPLATES,
      defaults: PLAN_DEFAULTS,
      referenceFileExists: () => true,
    });
    expect(overridden.mode).toBe("txt2img");
    expect(overridden.referenceActive).toBe(false);
  });

  it("blocks generation when the checkpoint is missing or unsupported", () => {
    const noCheckpoint = buildStoryScenePlan({
      story: makeStory(),
      scene: makeScene(),
      characters: [],
      recipes: [],
      models: [],
      workflows: WORKFLOW_TEMPLATES,
      defaults: PLAN_DEFAULTS,
      referenceFileExists: () => false,
    });
    expect(noCheckpoint.blockingIssues.join(" ")).toContain("No checkpoint");

    const unsupported = buildStoryScenePlan({
      story: makeStory(),
      scene: makeScene({ checkpointPath: "flux/flux1-dev.safetensors" }),
      characters: [],
      recipes: [],
      models: [makeCheckpointModel("flux/flux1-dev.safetensors", "flux")],
      workflows: WORKFLOW_TEMPLATES,
      defaults: PLAN_DEFAULTS,
      referenceFileExists: () => false,
    });
    expect(unsupported.architecture).toBe("flux");
    expect(unsupported.blockingIssues.join(" ")).toContain("not supported");
  });
});

function makeJob(id: string, overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id,
    promptId: `prompt_${id}`,
    status: "QUEUED",
    errorKind: "NONE",
    errorMessage: null,
    prompt: "cliff walk",
    negativePrompt: "lowres",
    checkpoint: "SDXL/base.safetensors",
    workflowId: "t2i_sdxl_base",
    workflowVersion: "1.0.0",
    mode: "txt2img",
    settings: {
      workflowId: "t2i_sdxl_base",
      mode: "txt2img",
      prompt: "cliff walk",
      negativePrompt: "lowres",
      checkpoint: "SDXL/base.safetensors",
      vae: null,
      loras: [],
      aspectRatio: "1:1",
      width: 1024,
      height: 1024,
      steps: 24,
      cfg: 6.5,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      seed: 123,
      randomSeed: false,
      batchCount: 1,
      batchSize: 1,
      outputFormat: "png",
      inputImagePath: null,
      denoise: 1,
    },
    progressStep: 0,
    progressMax: 24,
    currentNode: null,
    previewDataUrl: null,
    outputPaths: [],
    submittedAt: NOW,
    startedAt: null,
    completedAt: null,
    batchIndex: 1,
    batchTotal: 1,
    ...overrides,
  };
}

function makeImage(
  id: string,
  job: GenerationJob,
  overrides: Partial<GeneratedImageRecord> = {}
): GeneratedImageRecord {
  return {
    id,
    jobId: job.id,
    filePath: `C:\\out\\${id}.png`,
    fileName: `${id}.png`,
    format: "png",
    width: 1024,
    height: 1024,
    sizeBytes: 1024,
    prompt: job.prompt,
    negativePrompt: job.negativePrompt,
    seed: 123,
    checkpoint: job.checkpoint,
    loras: [],
    workflowId: job.workflowId,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    steps: 24,
    cfg: 6.5,
    denoise: 1,
    mode: "txt2img",
    favorite: false,
    tags: [],
    collectionId: null,
    createdAt: NOW,
    storyId: job.storyId ?? null,
    storySceneId: job.storySceneId ?? null,
    ...overrides,
  };
}

describe("Story repository", () => {
  function makeRepo() {
    const db = new StudioDatabase(":memory:");
    const repo = new StudioRepository(db);
    repo.upsertWorkflowMetadata(WORKFLOW_TEMPLATES);
    return { db, repo };
  }

  it("persists stories and cast while preserving untouched fields on partial updates", () => {
    const { db, repo } = makeRepo();
    const mira = repo.saveCharacter({ name: "Mira" });
    const ren = repo.saveCharacter({ name: "Ren" });

    const story = repo.saveStory({
      title: "The Lantern Keeper",
      logline: "Dusk on the cliff path.",
      stylePrompt: "soft teal grade",
      cast: [
        { characterId: mira.id, storyRole: "lead" },
        { characterId: ren.id, storyRole: "supporting" },
        { characterId: mira.id, storyRole: "cameo" },
      ],
    });

    expect(story.cast).toHaveLength(2);
    expect(story.cast[0]).toMatchObject({ characterId: mira.id, storyRole: "lead" });
    expect(story.scenes).toEqual([]);
    expect(repo.listStories()).toHaveLength(1);

    repo.saveStory({ id: story.id, title: "Lantern Keeper II", favorite: true });
    repo.markStoryInProgress(story.id);

    const partial = repo.saveStory({
      id: story.id,
      title: "Lantern Keeper III",
    });
    expect(partial.status).toBe("in_progress");
    expect(partial.favorite).toBe(true);
    expect(partial.cast).toHaveLength(2);
    expect(partial.stylePrompt).toBe("soft teal grade");

    const unknownCover = () =>
      repo.saveStory({
        id: story.id,
        title: "Bad cover",
        coverSceneId: "scene_unknown",
      });
    expect(unknownCover).toThrow(/Cover scene/);

    db.close();
  });

  it("orders scenes, reindexes after deletion, and replaces scene cast without duplicates", () => {
    const { db, repo } = makeRepo();
    const mira = repo.saveCharacter({ name: "Mira" });
    const ren = repo.saveCharacter({ name: "Ren" });

    let story = repo.saveStory({ title: "Sequence" });
    for (const title of ["One", "Two", "Three"]) {
      story = repo.saveStoryScene({ storyId: story.id, title, prompt: title });
    }
    const [first, second, third] = story.scenes;
    expect(story.scenes.map((scene) => scene.position)).toEqual([0, 1, 2]);

    const reordered = repo.reorderStoryScenes(story.id, [
      third!.id,
      first!.id,
    ]);
    expect(reordered?.scenes.map((scene) => scene.id)).toEqual([
      third!.id,
      first!.id,
      second!.id,
    ]);
    expect(reordered?.scenes.map((scene) => scene.position)).toEqual([0, 1, 2]);

    const withCast = repo.saveStoryScene({
      id: first!.id,
      storyId: story.id,
      cast: [
        { characterId: mira.id, roleHint: "lead" },
        { characterId: mira.id },
        { characterId: ren.id },
      ],
    });
    expect(
      withCast.scenes.find((scene) => scene.id === first!.id)?.cast.map(
        (member) => member.characterId
      )
    ).toEqual([mira.id, ren.id]);

    const replaced = repo.saveStoryScene({
      id: first!.id,
      storyId: story.id,
      cast: [{ characterId: ren.id }],
    });
    expect(
      replaced.scenes.find((scene) => scene.id === first!.id)?.cast
    ).toHaveLength(1);

    const afterDelete = repo.deleteStoryScene(story.id, first!.id);
    expect(afterDelete?.scenes).toHaveLength(2);
    expect(afterDelete?.scenes.map((scene) => scene.position)).toEqual([0, 1]);

    expect(repo.deleteStory(story.id)).toBe(true);
    const sceneCount = db.db
      .prepare("SELECT COUNT(*) AS n FROM story_scenes")
      .get() as { n: number };
    const castCount = db.db
      .prepare("SELECT COUNT(*) AS n FROM story_characters")
      .get() as { n: number };
    expect(sceneCount.n).toBe(0);
    expect(castCount.n).toBe(0);
    db.close();
  });

  it("syncs scene status from job lifecycle and auto-selects the first render", () => {
    const { db, repo } = makeRepo();
    const story = repo.saveStory({ title: "Render flow" });
    const withScene = repo.saveStoryScene({
      storyId: story.id,
      title: "Opening",
      prompt: "cliff walk at dusk",
    });
    const scene = withScene.scenes[0]!;

    const running = makeJob("job_scene", {
      status: "RUNNING",
      storyId: story.id,
      storySceneId: scene.id,
      progressStep: 8,
    });
    repo.upsertJob(running);
    let reloaded = repo.getStoryById(story.id);
    expect(reloaded?.scenes[0]?.status).toBe("generating");
    expect(reloaded?.scenes[0]?.lastJobId).toBe("job_scene");
    expect(reloaded?.status).toBe("draft");

    const completed = {
      ...makeJob("job_scene", {
        status: "COMPLETED",
        storyId: story.id,
        storySceneId: scene.id,
        progressStep: 24,
        completedAt: NOW,
        outputPaths: ["C:\\out\\img_scene.png"],
      }),
    };
    repo.recordCompletedGenerationTx(
      completed,
      [makeImage("img_scene", completed)],
      null
    );

    reloaded = repo.getStoryById(story.id);
    expect(reloaded?.status).toBe("in_progress");
    expect(reloaded?.scenes[0]?.status).toBe("completed");
    expect(reloaded?.scenes[0]?.selectedImageId).toBe("img_scene");

    const cleared = repo.selectStorySceneImage(story.id, scene.id, null);
    expect(cleared?.scenes[0]?.selectedImageId).toBeNull();
    expect(cleared?.scenes[0]?.status).toBe("draft");

    const reselected = repo.selectStorySceneImage(story.id, scene.id, "img_scene");
    expect(reselected?.scenes[0]?.selectedImageId).toBe("img_scene");
    expect(reselected?.scenes[0]?.status).toBe("completed");
    expect(() =>
      repo.selectStorySceneImage(story.id, scene.id, "img_missing")
    ).toThrow(/Unknown image/);

    const failed = makeJob("job_scene_fail", {
      status: "FAILED",
      storyId: story.id,
      storySceneId: scene.id,
    });
    repo.upsertJob(failed);
    reloaded = repo.getStoryById(story.id);
    expect(reloaded?.scenes[0]?.status).toBe("failed");
    db.close();
  });

  it("removes scene recipe links without deleting the scene when a recipe is deleted", () => {
    const { db, repo } = makeRepo();
    const story = repo.saveStory({ title: "Recipe link" });
    const recipe = repo.saveLoraRecipe({
      name: "Linked stack",
      items: [{ loraPath: "C:\\models\\loras\\a.safetensors" }],
    });
    const withScene = repo.saveStoryScene({
      storyId: story.id,
      title: "Linked",
      loraRecipeId: recipe.id,
    });
    expect(withScene.scenes[0]?.loraRecipeId).toBe(recipe.id);

    repo.deleteLoraRecipe(recipe.id);
    const reloaded = repo.getStoryById(story.id);
    expect(reloaded?.scenes).toHaveLength(1);
    expect(reloaded?.scenes[0]?.loraRecipeId).toBeNull();
    db.close();
  });
});
