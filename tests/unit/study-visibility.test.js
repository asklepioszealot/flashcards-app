import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { setShowReviewScheduleInfo } from "../../src/app/state.js";
import {
  setReviewScheduleVisibility,
  syncReviewScheduleVisibilityUi,
} from "../../src/features/study/study.js";

describe("Study review schedule visibility", () => {
  let dom;
  let previousDocument;

  beforeEach(() => {
    dom = new JSDOM(`
      <div id="review-due-summary">Tekrar Planı</div>
      <div id="review-current-card">Bu kart</div>
      <input id="review-schedule-visibility-toggle" type="checkbox" />
    `);
    previousDocument = global.document;
    global.document = dom.window.document;
    setShowReviewScheduleInfo(false);
  });

  afterEach(() => {
    global.document = previousDocument;
    setShowReviewScheduleInfo(false);
    dom.window.close();
  });

  it("should hide review schedule pills and keep the manager toggle off by default", () => {
    syncReviewScheduleVisibilityUi();

    expect(document.getElementById("review-due-summary").hidden).toBe(true);
    expect(document.getElementById("review-current-card").hidden).toBe(true);
    expect(document.getElementById("review-schedule-visibility-toggle").checked).toBe(false);
  });

  it("should show review schedule pills when the setting is enabled", () => {
    setReviewScheduleVisibility(true, { persist: false });

    expect(document.getElementById("review-due-summary").hidden).toBe(false);
    expect(document.getElementById("review-current-card").hidden).toBe(false);
    expect(document.getElementById("review-schedule-visibility-toggle").checked).toBe(true);
  });
});
