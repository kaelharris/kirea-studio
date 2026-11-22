import { describe, expect, it } from "vitest";
import { CivitaiSearchSchema } from "../../src/main/ipc/schemas";
import {
  CivitaiClient,
  buildLocalModelIndex,
  isVersionInstalled,
  mapCivitaiBaseModelQuery,
  mapCivitaiModel,
  mapCivitaiSort,
  mapCivitaiType,
  normalizeCivitaiBaseModel,
  stripCivitaiHtml,
  type RawCivitaiModel,
} from "../../src/main/civitai/civitai-client";
import type { ModelRecord } from "../../src/shared/types";

function makeModelRecord(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    id: "model_nova",
    name: "novaAnimeXL_v1",
    relativePath: "SDXL/novaAnimeXL_v1.safetensors",
    filePath: "C:\\Comfy\\models\\checkpoints\\SDXL\\novaAnimeXL_v1.safetensors",
    category: "checkpoint",
    architecture: "sdxl",
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
    lastSeenAt: "2026-11-11T10:00:00.000Z",
    ...overrides,
  };
}

const RAW_MODEL: RawCivitaiModel = {
  id: 501,
  name: "Anime Stylist",
  type: "LORA",
  nsfw: false,
  description: "<p>Sharp anime style</p><script>alert(1)</script>",
  tags: ["anime", "style"],
  creator: { username: "artist" },
  stats: { downloadCount: 1200, thumbsUpCount: 340, rating: 4.5 },
  modelVersions: [
    {
      id: 9001,
      name: "v1.0",
      baseModel: "SDXL 1.0",
      description: "<b>Release notes</b><br>Improved details",
      publishedAt: "2026-01-02T00:00:00.000Z",
      trainedWords: ["anime style", " "],
      files: [
        {
          name: "anime_stylist.safetensors",
          downloadUrl: "https://civitai.com/api/download/models/9001",
          sizeKB: 2048,
          hashes: { SHA256: "ABCDEF" },
        },
        {
          name: "anime_stylist.pt",
          downloadUrl: "https://civitai.com/api/download/models/9001",
          sizeKB: 2048,
        },
      ],
      images: [
        { url: "https://image.civitai.com/first.webp" },
        { url: "https://image.civitai.com/second.webp" },
        { url: "not-a-url" },
      ],
    },
  ],
};

describe("Civitai architecture and type normalization", () => {
  it("passes the live-supported sort values through unchanged", () => {
    // "Most Reactions"/"Most Comments" are rejected with HTTP 400 by the v1 models endpoint.
    expect(mapCivitaiSort("Most Liked")).toBe("Most Liked");
    expect(mapCivitaiSort("Most Discussed")).toBe("Most Discussed");
    expect(mapCivitaiSort("Most Downloaded")).toBe("Most Downloaded");
    expect(mapCivitaiSort(undefined)).toBe("Most Downloaded");
  });

  it.each([
    ["Illustrious", "illustrious"],
    ["NoobAI-XL", "illustrious"],
    ["Pony", "pony"],
    ["Flux.1 D", "flux"],
    ["Anima", "anima"],
    ["MOSS-Image", "moss_image"],
    ["Krea 2", "krea2"],
    ["Wan 2.1", "wan_video"],
    ["Z-Image Turbo", "z_image"],
    ["SD 1.5", "sd15"],
    ["stable diffusion 1", "sd15"],
    ["SDXL 1.0", "sdxl"],
    ["SD 2.1 768", "sdxl"],
    ["Something Else", "unknown"],
    [null, "unknown"],
  ])("maps base model %s to %s", (raw, expected) => {
    expect(normalizeCivitaiBaseModel(raw as string | null)).toBe(expected);
  });

  it("maps Civitai model types and rejects unsupported ones", () => {
    expect(mapCivitaiType("Checkpoint")).toBe("Checkpoint");
    expect(mapCivitaiType("LORA")).toBe("LORA");
    expect(mapCivitaiType("LoCon")).toBe("LORA");
    expect(mapCivitaiType("DoRA")).toBe("LORA");
    expect(mapCivitaiType("LyCORIS")).toBe("LORA");
    expect(mapCivitaiType("VAE")).toBe("VAE");
    expect(mapCivitaiType("Upscaler")).toBe("Upscaler");
    expect(mapCivitaiType("TextualInversion")).toBe("TextualInversion");
    expect(mapCivitaiType("Controlnet")).toBe("Controlnet");
    expect(mapCivitaiType("MotionModel")).toBe("MotionModel");
    expect(mapCivitaiType(null)).toBeNull();
  });

  it("strips HTML, scripts, and entities from descriptions", () => {
    const stripped = stripCivitaiHtml(
      "<div>Hello&nbsp;<b>world</b> &amp; friends</div><script>bad()</script><style>.x{}</style>"
    );
    expect(stripped).not.toContain("<");
    expect(stripped).not.toContain("bad()");
    expect(stripped).not.toContain(".x{}");
    expect(stripped).toContain("Hello");
    expect(stripped).toContain("world");
    expect(stripped).toContain("& friends");
  });

  it("returns null for empty descriptions", () => {
    expect(stripCivitaiHtml("   ")).toBeNull();
    expect(stripCivitaiHtml(null)).toBeNull();
  });
});

describe("Local model index and installed badges", () => {
  it("matches installed models by basename and SHA-256", () => {
    const index = buildLocalModelIndex([
      makeModelRecord(),
      makeModelRecord({
        id: "model_sha",
        filePath: "C:\\Comfy\\models\\loras\\other.safetensors",
        sha256: "deadbeef",
      }),
      makeModelRecord({
        id: "model_missing",
        filePath: "C:\\Comfy\\models\\loras\\missing.safetensors",
        installed: false,
      }),
    ]);

    expect(
      isVersionInstalled(
        { fileName: "novaAnimeXL_v1.safetensors", sha256: null },
        index
      )
    ).toBe(true);
    expect(
      isVersionInstalled({ fileName: "unrelated.safetensors", sha256: "DEADBEEF" }, index)
    ).toBe(true);
    expect(
      isVersionInstalled(
        { fileName: "missing.safetensors", sha256: null },
        index
      )
    ).toBe(false);
    expect(
      isVersionInstalled({ fileName: "unknown.safetensors", sha256: null }, index)
    ).toBe(false);
  });

  it("maps a raw model into a Civitai summary with install state and previews", () => {
    const local = [
      makeModelRecord({
        filePath: "C:\\Comfy\\models\\loras\\anime_stylist.safetensors",
        category: "lora",
      }),
    ];
    const mapped = mapCivitaiModel(RAW_MODEL, buildLocalModelIndex(local));

    expect(mapped).not.toBeNull();
    expect(mapped).toMatchObject({
      id: 501,
      name: "Anime Stylist",
      creator: "artist",
      type: "LORA",
      nsfw: false,
      installed: true,
      primaryPreviewUrl: "https://image.civitai.com/first.webp",
      stats: { downloads: 1200, thumbsUp: 340, rating: 4.5 },
    });
    expect(mapped?.description).toContain("Sharp anime style");
    expect(mapped?.versions).toHaveLength(1);

    const version = mapped!.versions[0]!;
    expect(version).toMatchObject({
      id: 9001,
      name: "v1.0",
      architecture: "sdxl",
      fileName: "anime_stylist.safetensors",
      sizeBytes: 2048 * 1024,
      sha256: "abcdef",
      installed: true,
    });
    expect(version.trainedWords).toEqual(["anime style"]);
    expect(version.sampleImageUrls).toEqual([
      "https://image.civitai.com/first.webp",
      "https://image.civitai.com/second.webp",
    ]);
    expect(version.releaseNotes).toContain("Release notes");
  });

  it("prefers Civitai's primary model file over unrelated or non-primary files", () => {
    const mapped = mapCivitaiModel(
      {
        ...RAW_MODEL,
        modelVersions: [
          {
            id: 9100,
            name: "multi-file",
            baseModel: "Flux.1 D",
            files: [
              {
                name: "flux-dev-full.safetensors",
                downloadUrl: "https://civitai.com/api/download/models/9100?fileId=1",
                sizeKB: 23_000_000,
                type: "Model",
              },
              {
                name: "flux-dev-primary.safetensors",
                downloadUrl: "https://civitai.com/api/download/models/9100?fileId=2",
                sizeKB: 17_000_000,
                type: "Model",
                primary: true,
              },
              {
                name: "diffusion_pytorch_model.safetensors",
                downloadUrl: "https://civitai.com/api/download/models/9100?type=VAE",
                sizeKB: 160,
                type: "VAE",
                primary: true,
              },
            ],
          },
        ],
      },
      buildLocalModelIndex([])
    );

    expect(mapped?.versions[0]?.fileName).toBe("flux-dev-primary.safetensors");
    expect(mapped?.versions[0]?.downloadUrl).toContain("fileId=2");
  });

  it("selects the primary model even when the VAE file is listed first", () => {
    const mapped = mapCivitaiModel(
      {
        ...RAW_MODEL,
        type: "Checkpoint",
        modelVersions: [
          {
            id: 9200,
            name: "vae-first",
            baseModel: "Illustrious",
            files: [
              {
                name: "vae.safetensors",
                downloadUrl: "https://civitai.com/api/download/models/9200?type=VAE",
                sizeKB: 160,
                type: "VAE",
                primary: true,
              },
              {
                name: "checkpoint.safetensors",
                downloadUrl: "https://civitai.com/api/download/models/9200",
                sizeKB: 2_000_000,
                type: "Model",
              },
            ],
          },
        ],
      },
      buildLocalModelIndex([])
    );

    expect(mapped?.versions[0]?.fileName).toBe("checkpoint.safetensors");
  });

  it("marks versions with no downloadable model file as unavailable", () => {
    const mapped = mapCivitaiModel(
      {
        ...RAW_MODEL,
        modelVersions: [
          { id: 9300, name: "Pro (no file)", baseModel: "Flux.1 D", files: [] },
        ],
      },
      buildLocalModelIndex([])
    );

    const version = mapped?.versions[0];
    expect(version?.downloadable).toBe(false);
    expect(version?.downloadUrl).toBe("");
  });

  it("drops models with unsupported types or no usable versions", () => {
    expect(
      mapCivitaiModel(
        { ...RAW_MODEL, type: "NonExistentFakeType" },
        buildLocalModelIndex([])
      )
    ).toBeNull();
    expect(
      mapCivitaiModel(
        { ...RAW_MODEL, modelVersions: [] },
        buildLocalModelIndex([])
      )
    ).toBeNull();
  });

  it("caps versions at 12", () => {
    const versions = Array.from({ length: 15 }, (_, i) => ({
      id: 1000 + i,
      name: `v${i}`,
      baseModel: "SD 1.5",
      files: [{ name: `model-${i}.safetensors` }],
    }));
    const mapped = mapCivitaiModel(
      { ...RAW_MODEL, modelVersions: versions },
      buildLocalModelIndex([])
    );
    expect(mapped?.versions).toHaveLength(12);
  });
});

describe("CivitaiClient HTTP behavior", () => {
  it("builds query parameters, authorization, and maps results", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({ items: [RAW_MODEL], metadata: { nextCursor: "next-1" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const client = new CivitaiClient({ getApiKey: () => "secret-token", fetcher });
    const result = await client.searchModels(
      {
        query: "anime",
        type: "LORA",
        baseModel: "SDXL 1.0",
        sort: "Newest",
        nsfw: true,
        cursor: "cursor-abc",
        limit: 100,
      },
      [makeModelRecord({ filePath: "C:\\models\\anime_stylist.safetensors" })]
    );

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    const url = new URL(call.url);
    expect(url.origin + url.pathname).toBe("https://civitai.com/api/v1/models");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("sort")).toBe("Newest");
    expect(url.searchParams.get("nsfw")).toBe("true");
    expect(url.searchParams.get("query")).toBe("anime");
    expect(url.searchParams.get("types")).toBe("LORA");
    expect(url.searchParams.get("baseModels")).toBe("SDXL 1.0");
    expect(url.searchParams.get("cursor")).toBe("cursor-abc");
    expect(
      (call.init?.headers as Record<string, string>).Authorization
    ).toBe("Bearer secret-token");

    expect(result.nextCursor).toBe("next-1");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.installed).toBe(true);
  });

  it("omits empty optional parameters and sends nsfw=false by default", async () => {
    let capturedUrl = "";
    const fetcher = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    const client = new CivitaiClient({ getApiKey: () => null, fetcher });
    await client.searchModels({});

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("limit")).toBe("24");
    expect(url.searchParams.get("nsfw")).toBe("false");
    expect(url.searchParams.get("query")).toBeNull();
    expect(url.searchParams.get("types")).toBeNull();
    expect(url.searchParams.get("baseModels")).toBeNull();
    expect(url.searchParams.get("cursor")).toBeNull();
  });

  it("normalizes baseModel query parameters for Civitai API compatibility", async () => {
    expect(mapCivitaiBaseModelQuery("MOSS-Image")).toBe("MOSS Image");
    expect(mapCivitaiBaseModelQuery("moss_image")).toBe("MOSS Image");
    expect(mapCivitaiBaseModelQuery("MOSS Image")).toBe("MOSS Image");
    expect(mapCivitaiBaseModelQuery("moss")).toBe("MOSS Image");
    expect(mapCivitaiBaseModelQuery("krea-2")).toBe("Krea 2");
    expect(mapCivitaiBaseModelQuery("SDXL 1.0")).toBe("SDXL 1.0");
    expect(mapCivitaiBaseModelQuery("Illustrious")).toBe("Illustrious");

    let capturedUrl = "";
    const fetcher = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    const client = new CivitaiClient({ getApiKey: () => null, fetcher });
    await client.searchModels({ baseModel: "MOSS-Image" as any });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("baseModels")).toBe("MOSS Image");
  });

  it("surfaces authentication, rate limit, and HTTP failures", async () => {
    const clientFor = (status: number): CivitaiClient =>
      new CivitaiClient({
        getApiKey: () => "key",
        fetcher: (async () =>
          new Response("denied", { status })) as typeof fetch,
      });

    await expect(
      clientFor(401).searchModels({})
    ).rejects.toThrow(/rejected the stored API key/i);
    await expect(
      clientFor(403).getModelDetails(1)
    ).rejects.toThrow(/rejected the stored API key/i);
    await expect(clientFor(429).searchModels({})).rejects.toThrow(/rate limit/i);
    await expect(clientFor(500).searchModels({})).rejects.toThrow(/HTTP 500/i);
  });

  it("reports connection status for anonymous and authenticated browsing", async () => {
    const okFetcher = (async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 })) as typeof fetch;

    const anonymous = await new CivitaiClient({
      getApiKey: () => null,
      fetcher: okFetcher,
    }).testConnection();
    expect(anonymous).toMatchObject({ ok: true, authenticated: false });
    expect(anonymous.message).toMatch(/public browsing works/i);

    const authenticated = await new CivitaiClient({
      getApiKey: () => "key",
      fetcher: okFetcher,
    }).testConnection();
    expect(authenticated).toMatchObject({ ok: true, authenticated: true });
    expect(authenticated.message).toMatch(/authenticated/i);

    const rejected = await new CivitaiClient({
      getApiKey: () => "key",
      fetcher: (async () => new Response("no", { status: 401 })) as typeof fetch,
    }).testConnection();
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toMatch(/rejected/i);
  });

  it("validates CivitaiSearchSchema across all supported base models and types", () => {
    const allBases = [
      "Illustrious",
      "SDXL 1.0",
      "Pony",
      "SD 1.5",
      "Anima",
      "Flux.1 D",
      "MOSS-Image",
      "Krea 2",
      "Wan 2.1",
      "Z-Image Turbo",
    ];

    const allTypes = [
      "Checkpoint",
      "LORA",
      "TextualInversion",
      "VAE",
      "Controlnet",
      "Upscaler",
      "MotionModel",
      "Other",
    ];

    for (const baseModel of allBases) {
      const parsed = CivitaiSearchSchema.parse({ baseModel });
      expect(parsed.baseModel).toBe(baseModel);
    }

    for (const type of allTypes) {
      const parsed = CivitaiSearchSchema.parse({ type });
      expect(parsed.type).toBe(type);
    }

    const full = CivitaiSearchSchema.parse({
      query: "anime portrait",
      baseModel: "MOSS-Image",
      type: "Controlnet",
      sort: "Most Downloaded",
      period: "AllTime",
      nsfw: false,
      limit: 24,
    });
    expect(full.baseModel).toBe("MOSS-Image");
    expect(full.type).toBe("Controlnet");
  });
});
