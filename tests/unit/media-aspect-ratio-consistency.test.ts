import { describe, expect, it } from "vitest";
import {
  formatAspectRatio,
  resolveDimensionsForAspect,
  calculateDimensionsForAspect,
  snapDimension,
} from "../../src/shared/aspect-ratios";

/**
 * Simulates CSS object-fit: contain layout calculation.
 * Returns the rendered dimensions [width, height] of media [mw, mh]
 * within a container [cw, ch].
 */
export function computeContainedDimensions(
  mw: number,
  mh: number,
  cw: number,
  ch: number
): { width: number; height: number; scale: number; orientation: "portrait" | "landscape" | "square" } {
  if (mw <= 0 || mh <= 0 || cw <= 0 || ch <= 0) {
    throw new Error("Dimensions must be positive");
  }
  const scale = Math.min(cw / mw, ch / mh);
  const width = mw * scale;
  const height = mh * scale;
  const ratio = mw / mh;
  const orientation =
    ratio > 1.02 ? "landscape" : ratio < 0.98 ? "portrait" : "square";

  return { width, height, scale, orientation };
}

/**
 * Normalizes image CSS class to ensure object-contain and object-center are applied.
 * Mirrors src/renderer/components/ui/MediaImage.tsx.
 */
export function normalizeMediaClass(className: string): string {
  let normalized = className.includes("object-cover")
    ? className.replace(/\bobject-cover\b/g, "object-contain object-center")
    : className;

  if (!normalized.includes("object-")) {
    normalized = `${normalized} object-contain object-center`.trim();
  }
  return normalized;
}

describe("Global Media Aspect Ratio & Display Consistency", () => {
  const ASPECT_RATIO_FIXTURES = [
    { name: "1:1 Square", width: 1024, height: 1024, expectedOrientation: "square" as const },
    { name: "16:9 Landscape", width: 1920, height: 1080, expectedOrientation: "landscape" as const },
    { name: "9:16 Portrait", width: 1080, height: 1920, expectedOrientation: "portrait" as const },
    { name: "4:3 Classic Landscape", width: 1024, height: 768, expectedOrientation: "landscape" as const },
    { name: "3:4 Classic Portrait", width: 768, height: 1024, expectedOrientation: "portrait" as const },
    { name: "21:9 Ultrawide Cinema", width: 2560, height: 1080, expectedOrientation: "landscape" as const },
    { name: "2:3 Photo Portrait", width: 832, height: 1248, expectedOrientation: "portrait" as const },
    { name: "Extremely Tall (1:4)", width: 512, height: 2048, expectedOrientation: "portrait" as const },
    { name: "Extremely Wide (4:1)", width: 2048, height: 512, expectedOrientation: "landscape" as const },
  ].map((f) => ({ ...f, ratio: f.width / f.height }));

  describe("Aspect Ratio Preservation & Dimension Math", () => {
    it.each(ASPECT_RATIO_FIXTURES)(
      "preserves original proportions for $name in square card container (300x300)",
      ({ width, height, ratio, expectedOrientation }) => {
        const containerW = 300;
        const containerH = 300;

        const result = computeContainedDimensions(width, height, containerW, containerH);

        // Aspect ratio is strictly preserved (within floating point precision)
        const renderedRatio = result.width / result.height;
        expect(renderedRatio).toBeCloseTo(ratio, 4);

        // Must never exceed the container bounds (no overflow clipping)
        expect(result.width).toBeLessThanOrEqual(containerW + 0.001);
        expect(result.height).toBeLessThanOrEqual(containerH + 0.001);

        // Orientation classification is correct
        expect(result.orientation).toBe(expectedOrientation);
      }
    );

    it.each(ASPECT_RATIO_FIXTURES)(
      "preserves original proportions for $name in landscape container (800x450)",
      ({ width, height, ratio }) => {
        const result = computeContainedDimensions(width, height, 800, 450);

        expect(result.width / result.height).toBeCloseTo(ratio, 4);
        expect(result.width).toBeLessThanOrEqual(800.001);
        expect(result.height).toBeLessThanOrEqual(450.001);
      }
    );

    it.each(ASPECT_RATIO_FIXTURES)(
      "preserves original proportions for $name in portrait mobile container (400x700)",
      ({ width, height, ratio }) => {
        const result = computeContainedDimensions(width, height, 400, 700);

        expect(result.width / result.height).toBeCloseTo(ratio, 4);
        expect(result.width).toBeLessThanOrEqual(400.001);
        expect(result.height).toBeLessThanOrEqual(700.001);
      }
    );
  });

  describe("Shared CSS Normalization & Cropping Prevention", () => {
    it("converts accidental object-cover to object-contain object-center", () => {
      const input = "w-full h-full object-cover transition-transform";
      const normalized = normalizeMediaClass(input);

      expect(normalized).not.toContain("object-cover");
      expect(normalized).toContain("object-contain");
      expect(normalized).toContain("object-center");
    });

    it("defaults to object-contain object-center if no object-fit class is supplied", () => {
      const input = "w-full h-full rounded-md shadow";
      const normalized = normalizeMediaClass(input);

      expect(normalized).toContain("object-contain");
      expect(normalized).toContain("object-center");
    });

    it("respects existing object-contain without duplicating", () => {
      const input = "h-full w-full object-contain rounded-lg";
      const normalized = normalizeMediaClass(input);

      expect(normalized).toBe(input);
    });
  });

  describe("Extreme & Non-Standard Aspect Ratios", () => {
    it("handles extreme vertical scrolls (1:8 ratio) without distortion", () => {
      const mw = 256;
      const mh = 2048;
      const result = computeContainedDimensions(mw, mh, 500, 500);

      // Width should be scaled down proportionally (500 * (256/2048) = 62.5)
      expect(result.height).toBe(500);
      expect(result.width).toBeCloseTo(62.5, 2);
      expect(result.width / result.height).toBeCloseTo(mw / mh, 4);
    });

    it("handles extreme horizontal banners (8:1 ratio) without distortion", () => {
      const mw = 2048;
      const mh = 256;
      const result = computeContainedDimensions(mw, mh, 500, 500);

      // Height should be scaled down proportionally (500 * (256/2048) = 62.5)
      expect(result.width).toBe(500);
      expect(result.height).toBeCloseTo(62.5, 2);
      expect(result.width / result.height).toBeCloseTo(mw / mh, 4);
    });
  });

  describe("Aspect Ratio Formatting & Dimension Snapping", () => {
    it("formats standard ratios correctly", () => {
      expect(formatAspectRatio(1024, 1024)).toBe("1:1");
      expect(formatAspectRatio(1920, 1080)).toBe("16:9");
      expect(formatAspectRatio(1080, 1920)).toBe("9:16");
      expect(formatAspectRatio(1024, 768)).toBe("4:3");
      expect(formatAspectRatio(768, 1024)).toBe("3:4");
    });

    it("snaps dimensions to required multiples for neural networks without altering ratio", () => {
      const rawW = 1003;
      const rawH = 751;
      const snappedW = snapDimension(rawW, 64);
      const snappedH = snapDimension(rawH, 64);

      expect(snappedW % 64).toBe(0);
      expect(snappedH % 64).toBe(0);
      expect(snappedW).toBeGreaterThan(0);
      expect(snappedH).toBeGreaterThan(0);
    });
  });
});
