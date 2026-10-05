import type { SyncOperation } from "./sync-events";

type Op<T extends SyncOperation["type"]> = Extract<SyncOperation, { type: T }>;

export const roundUpdated = (
  overrides: Partial<Op<"round.updated">> = {},
): SyncOperation => ({
  type: "round.updated",
  eventId: "e-round-updated",
  roundId: "round-1",
  changes: {
    name: "名前",
    roundDate: "2026-09-15",
    format: "outdoor",
    bowType: "recurve",
  },
  ...overrides,
});

export const roundDisabled = (eventId = "e-round-disabled"): SyncOperation => ({
  type: "round.disabled",
  eventId,
  roundId: "round-1",
});

export const distanceCreated = (
  overrides: Partial<Op<"distance.created">> = {},
): SyncOperation => ({
  type: "distance.created",
  eventId: "e-distance-created",
  id: "d-1",
  roundId: "round-1",
  positionKey: "a",
  distance: 70,
  totalEnds: 6,
  arrowsPerEnd: 6,
  targetFaceId: "face-1",
  isMarked: true,
  ...overrides,
});

export const distanceUpdated = (
  overrides: Partial<Op<"distance.updated">> = {},
): SyncOperation => ({
  type: "distance.updated",
  eventId: "e-distance-updated",
  distanceId: "d-1",
  changes: {
    distance: 50,
    isMarked: false,
    config: { totalEnds: 3, arrowsPerEnd: 3, targetFaceId: "face-2" },
  },
  ...overrides,
});

export const distanceDisabled = (
  distanceId = "d-1",
  eventId = "e-distance-disabled",
): SyncOperation => ({ type: "distance.disabled", eventId, distanceId });

export const shotRecorded = (
  overrides: Partial<Op<"shot.recorded">> = {},
): SyncOperation => ({
  type: "shot.recorded",
  eventId: "e-shot-recorded",
  distanceId: "d-1",
  endNumber: 1,
  arrowNumber: 1,
  scoreStr: "10",
  scoreInt: 10,
  ...overrides,
});

export const shotCleared = (
  overrides: Partial<Op<"shot.cleared">> = {},
): SyncOperation => ({
  type: "shot.cleared",
  eventId: "e-shot-cleared",
  distanceId: "d-1",
  endNumber: 1,
  arrowNumber: 1,
  ...overrides,
});

export const roundCreated = (
  overrides: Partial<Op<"round.created">> = {},
): SyncOperation => ({
  type: "round.created",
  eventId: "e-round-created",
  roundId: "round-1",
  name: "",
  roundDate: "2026-09-29",
  format: "indoor",
  bowType: "compound",
  distances: [
    {
      eventId: "e-created-d-1",
      id: "d-1",
      positionKey: "a",
      distance: 18,
      isMarked: true,
      totalEnds: 10,
      arrowsPerEnd: 3,
      targetFaceId: "face-1",
    },
  ],
  ...overrides,
});
