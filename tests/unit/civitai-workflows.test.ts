import { describe, expect, it } from "vitest";
import {
  CivitaiClient,
  detectWorkflowCategories,
  mapCivitaiWorkflow,
  type RawCivitaiModel,
} from "../../src/main/civitai/civitai-client";

const RAW_WORKFLOW: RawCivitaiModel = {
  id: 777,
  name: "Flux Inpaint Detailer",
  type: "Workflows",
  nsfw: false,
  description: "<p>A <b>Flux</b> inpaint workflow</p><script>alert(1)</script>",
  tags: ["flux", "inpaint"],
  creator: { username: "flowmaster" },
  baseModels: ["Flux.1 D"],
  stats: { downloadCount: 900, thumbsUpCount: 120, rating: 4.8 },
  modelVersions: [
    {
      id: 3001,
      name: "v2",
      baseModel: "Flux.1 D",
      description: "<i>release notes</i>",
      publishedAt: "2026-03-04T00:00:00.000Z",
      stats: { downloadCount: 300, thumbsUpCount: 30, thumbsDownCount: 3 },
      images: [
        { url: "https://image.civitai.com/a.webp" },
        { url: "data:image/png;base64,ignored" },
        { url: "https://image.civitai.com/b.webp" },
      ],
      files: [
        {
          id: 1,
          name: "readme.txt",
          type: "Other",
          downloadUrl: "https://civitai.com/api/download/models/3001",
          sizeKB: 1,
        },
        {
          id: 2,
          name: "flow.json",
          type: "Config",
          downloadUrl: "https://civitai.com/api/download/models/3001?type=Config",
          sizeKB: 2,
          hashes: { SHA256: "ABC123" },
        },
        {
          id: 3,
          name: "bundle.zip",
          type: "Archive",
          downloadUrl: "https://civitai.com/api/download/models/3001?type=Archive",
          sizeKB: 4,
        },
      ],
    },
  ],
};

function page(items: RawCivitaiModel[], nextCursor: string | null = null): Response {
  return new Response(JSON.stringify({ items, metadata: { nextCursor } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function workflowModel(
  id: number,
  name: string,
  tags: string[],
  fileName = "workflow.json"
): RawCivitaiModel {
  return {
    id,
    name,
    type: "Workflows",
    tags,
    modelVersions: [
      {
        id: id * 10,
        name: "v1",
        baseModel: "SDXL 1.0",
        files: [{ name: fileName, type: "Config", downloadUrl: `https://civitai.com/api/download/models/${id * 10}` }],
      },
    ],
  };
}

describe("Civitai workflow category inference", () => {
  it("orders every matched category and falls back to other", () => {
    expect(
      detectWorkflowCategories({
        name: "animated video inpaint upscale img2img flux",
      })
    ).toEqual([
      "image-generation",
      "image-editing",
      "inpainting",
      "upscaling",
      "animation",
      "video-generation",
    ]);

    expect(
      detectWorkflowCategories({
        name: "Aria sprite sheet",
        tags: ["pixel art"],
        fileNames: ["aria-workflow.json"],
      })
    ).toEqual(["animation"]);

    expect(
      detectWorkflowCategories({
        name: "Untitled experiment",
        tags: [],
        baseModel: null,
        fileNames: ["workflow.json"],
      })
    ).toEqual(["other"]);
  });

  it("only infers categories from metadata Civitai actually returns", () => {
    expect(detectWorkflowCategories({ name: "Landscape pass" })).toEqual(["other"]);
    expect(
      detectWorkflowCategories({ name: "Landscape pass", tags: ["outpaint"] })
    ).toEqual(["inpainting"]);
    expect(
      detectWorkflowCategories({ name: "Landscape pass", baseModel: "Wan 2.1" })
    ).toEqual(["video-generation"]);
  });
});

describe("Civitai workflow mapping", () => {
  it("maps a workflow model with files, previews, stats, and categories", () => {
    const mapped = mapCivitaiWorkflow(RAW_WORKFLOW);
    expect(mapped).not.toBeNull();
    expect(mapped).toMatchObject({
      id: 777,
      name: "Flux Inpaint Detailer",
      creator: "flowmaster",
      nsfw: false,
      baseModels: ["Flux.1 D"],
      primaryPreviewUrl: "https://image.civitai.com/a.webp",
      installed: false,
      importedAt: null,
      stats: { downloads: 900, thumbsUp: 120, rating: 4.8 },
    });
    expect(mapped?.description).toBe("A Flux inpaint workflow");
    expect(mapped?.categories).toEqual([
      "image-generation",
      "image-editing",
      "inpainting",
    ]);

    const version = mapped!.versions[0]!;
    expect(version).toMatchObject({
      id: 3001,
      name: "v2",
      baseModel: "Flux.1 D",
      description: "release notes",
      installed: false,
      installedFileName: null,
      categories: ["image-generation", "image-editing", "inpainting"],
      stats: { downloads: 300, thumbsUp: 30, thumbsDown: 3 },
    });
    expect(version.previewImageUrls).toEqual([
      "https://image.civitai.com/a.webp",
      "https://image.civitai.com/b.webp",
    ]);

    expect(version.files.map((file) => [file.fileName, file.kind])).toEqual([
      ["readme.txt", "unsupported"],
      ["flow.json", "json"],
      ["bundle.zip", "zip"],
    ]);
    expect(version.files[1]!.sha256).toBe("abc123");
    expect(version.files[1]!.sizeBytes).toBe(2 * 1024);
    expect(version.primaryFile?.fileName).toBe("flow.json");
  });

  it("rejects non-workflow model types and versions without files", () => {
    expect(mapCivitaiWorkflow({ ...RAW_WORKFLOW, type: "LORA" })).toBeNull();
    expect(mapCivitaiWorkflow({ ...RAW_WORKFLOW, modelVersions: [] })).toBeNull();
    expect(mapCivitaiWorkflow({ ...RAW_WORKFLOW, modelVersions: [{ id: 1 }] })).toBeNull();
    expect(mapCivitaiWorkflow({ ...RAW_WORKFLOW, type: null })).not.toBeNull();
  });

  it("caps the number of versions it exposes", () => {
    const versions = Array.from({ length: 25 }, (_, index) => ({
      id: 1000 + index,
      name: `v${index}`,
      files: [{ name: `flow-${index}.json`, downloadUrl: `https://civitai.com/api/download/models/${1000 + index}` }],
    }));
    const mapped = mapCivitaiWorkflow({ ...RAW_WORKFLOW, modelVersions: versions });
    expect(mapped?.versions).toHaveLength(20);
  });
});

describe("Civitai workflow search contract", () => {
  it("uses the workflow type filter, pagination, auth, and never leaks the key", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return page([RAW_WORKFLOW], "next-1");
    }) as typeof fetch;

    const client = new CivitaiClient({ getApiKey: () => "secret-token", fetcher });
    const result = await client.searchWorkflows({
      query: " flux ",
      sort: "Newest",
      nsfw: true,
      cursor: "cursor-abc",
      limit: 200,
    });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://civitai.com/api/v1/models");
    expect(url.searchParams.get("types")).toBe("Workflows");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("sort")).toBe("Newest");
    expect(url.searchParams.get("nsfw")).toBe("true");
    expect(url.searchParams.get("query")).toBe("flux");
    expect(url.searchParams.get("cursor")).toBe("cursor-abc");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token"
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(777);
    expect(result.nextCursor).toBe("next-1");
    expect(result.categoryFiltered).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("does not spend extra pages when no category filter is active", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return page([RAW_WORKFLOW], "another-page");
    }) as typeof fetch;

    const client = new CivitaiClient({ getApiKey: () => null, fetcher });
    const result = await client.searchWorkflows({ limit: 12 });

    expect(calls).toBe(1);
    expect(result.nextCursor).toBe("another-page");
    expect(result.items[0]!.installed).toBe(false);
  });

  it("filters categories across pages and removes duplicates", async () => {
    const calls: string[] = [];
    const pages = [
      page([workflowModel(901, "Flux portrait", ["flux"])], "p1"),
      page(
        [
          workflowModel(902, "4x Upscaler", ["upscale"]),
          workflowModel(902, "4x Upscaler duplicate", ["upscale"]),
        ],
        "p2"
      ),
      page([], null),
    ];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return pages[calls.length - 1]!;
    }) as typeof fetch;

    const client = new CivitaiClient({ getApiKey: () => null, fetcher });
    const result = await client.searchWorkflows({ category: "upscaling", limit: 10 });

    expect(calls.length).toBe(3);
    expect(calls.every((url) => new URL(url).searchParams.get("types") === "Workflows")).toBe(
      true
    );
    expect(result.categoryFiltered).toBe(true);
    expect(result.items.map((item) => item.id)).toEqual([902]);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(result.items.length);
  });

  it("stops after four pages when a category rarely matches", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return page([workflowModel(calls, `Landscape pass ${calls}`, [])], `page-${calls}`);
    }) as typeof fetch;

    const client = new CivitaiClient({ getApiKey: () => null, fetcher });
    const result = await client.searchWorkflows({ category: "inpainting", limit: 10 });

    expect(calls).toBe(4);
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBe("page-4");
  });

  it("surfaces authentication, not-found, rate limit, and HTTP failures", async () => {
    const clientFor = (status: number, apiKey: string | null = "key"): CivitaiClient =>
      new CivitaiClient({
        getApiKey: () => apiKey,
        fetcher: (async () => new Response("denied", { status })) as typeof fetch,
      });

    await expect(clientFor(401).searchWorkflows({})).rejects.toThrow(
      /rejected the stored API key/i
    );
    await expect(clientFor(403, null).searchWorkflows({})).rejects.toThrow(
      /requires an API key/i
    );
    await expect(clientFor(404).getWorkflowDetails(5)).rejects.toThrow(/could not find/i);
    await expect(clientFor(429).searchWorkflows({})).rejects.toThrow(/rate limit/i);
    await expect(clientFor(500).searchWorkflows({})).rejects.toThrow(/HTTP 500/i);
  });

  it("rejects workflow details that have no downloadable versions", async () => {
    const fetcher = (async () =>
      page([{ ...RAW_WORKFLOW, modelVersions: [] }])) as typeof fetch;
    const client = new CivitaiClient({ getApiKey: () => null, fetcher });
    await expect(client.getWorkflowDetails(777)).rejects.toThrow(/no downloadable versions/i);
  });
});
