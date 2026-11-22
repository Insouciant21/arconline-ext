import { describe, expect, it } from "vitest";
import {
  computeMinFillRatio,
  computeProgressMetrics,
  pointerOffsetToScrollTop,
} from "../src/lib/gradient-scrollbar";

describe("gradient scrollbar math", () => {
  it("clamps computeMinFillRatio between floor and ceiling", () => {
    expect(computeMinFillRatio(0)).toBe(0.08);
    expect(computeMinFillRatio(-120)).toBe(0.08);
    expect(computeMinFillRatio(Number.NaN)).toBe(0.08);

    // Very short track hits the 22% ceiling (32 / 100 = 0.32 -> 0.22).
    expect(computeMinFillRatio(100)).toBeCloseTo(0.22, 6);

    // Medium track stays proportional (32 / 250 = 0.128).
    expect(computeMinFillRatio(250)).toBeCloseTo(0.128, 6);

    // Tall viewport hits the 8% floor (32 / 1000 = 0.032 -> 0.08).
    expect(computeMinFillRatio(1000)).toBeCloseTo(0.08, 6);
  });

  it("computes progress metrics across non-scrollable, top, middle, and bottom states", () => {
    // Non-scrollable and sub-pixel <= 1px tolerance
    expect(
      computeProgressMetrics({
        scrollTop: 0,
        scrollHeight: 400,
        clientHeight: 400,
        trackHeight: 400,
      }),
    ).toMatchObject({
      maxScroll: 0,
      scrollable: false,
      scrollFraction: 0,
      fillFraction: 0,
    });

    expect(
      computeProgressMetrics({
        scrollTop: 0,
        scrollHeight: 401,
        clientHeight: 400,
        trackHeight: 400,
      }),
    ).toMatchObject({
      maxScroll: 1,
      scrollable: false,
      scrollFraction: 0,
      fillFraction: 0,
    });

    // Top (0%), middle (50%), bottom (100%) on a 250px track (minFillRatio = 0.128)
    const top = computeProgressMetrics({
      scrollTop: 0,
      scrollHeight: 1250,
      clientHeight: 250,
      trackHeight: 250,
    });
    expect(top.scrollable).toBe(true);
    expect(top.scrollFraction).toBe(0);
    expect(top.minFillRatio).toBeCloseTo(0.128, 6);
    expect(top.fillFraction).toBeCloseTo(0.128, 6);

    const middle = computeProgressMetrics({
      scrollTop: 500,
      scrollHeight: 1250,
      clientHeight: 250,
      trackHeight: 250,
    });
    expect(middle.scrollFraction).toBeCloseTo(0.5, 6);
    expect(middle.fillFraction).toBeCloseTo(0.128 + (1 - 0.128) * 0.5, 6);

    const bottom = computeProgressMetrics({
      scrollTop: 1000,
      scrollHeight: 1250,
      clientHeight: 250,
      trackHeight: 250,
    });
    expect(bottom.scrollFraction).toBe(1);
    expect(bottom.fillFraction).toBeCloseTo(1, 6);
  });

  it("maps pointer offsets to scrollTop with 1:1 cursor alignment", () => {
    expect(pointerOffsetToScrollTop({ offsetY: 100, trackHeight: 0, maxScroll: 500 })).toBe(0);
    expect(pointerOffsetToScrollTop({ offsetY: 100, trackHeight: 500, maxScroll: 0 })).toBe(0);

    const trackHeight = 500;
    const clientHeight = 500;
    const maxScroll = 1500;
    const scrollHeight = clientHeight + maxScroll;
    const minPx = computeMinFillRatio(trackHeight) * trackHeight;

    // Deadzone at or above minPx clamps to 0
    expect(pointerOffsetToScrollTop({ offsetY: -20, trackHeight, maxScroll })).toBe(0);
    expect(pointerOffsetToScrollTop({ offsetY: minPx, trackHeight, maxScroll })).toBe(0);

    // Overflow past bottom edge clamps to maxScroll
    expect(pointerOffsetToScrollTop({ offsetY: trackHeight, trackHeight, maxScroll })).toBe(maxScroll);
    expect(pointerOffsetToScrollTop({ offsetY: trackHeight + 80, trackHeight, maxScroll })).toBe(maxScroll);

    // Round-trip consistency in draggable range: fill tip lands on cursor offsetY
    for (const ratio of [0.1, 0.25, 0.5, 0.75, 0.95]) {
      const offsetY = minPx + (trackHeight - minPx) * ratio;
      const scrollTop = pointerOffsetToScrollTop({ offsetY, trackHeight, maxScroll });
      const metrics = computeProgressMetrics({
        scrollTop,
        scrollHeight,
        clientHeight,
        trackHeight,
      });
      expect(metrics.fillFraction * trackHeight).toBeCloseTo(offsetY, 6);
    }
  });
});
