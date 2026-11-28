import type { RoundBaseRecord } from "./round-base";
import type { RoundConfig } from "./round-config";
import type { RoundRevisions, RoundTables } from "./round-tables";
import type { Distance, Shooter, Shot } from "./scorecard-types";
import type { RoundStatus, SyncOperation } from "./sync-events";

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
    config: { totalEnds: 12, arrowsPerEnd: 3, targetFaceId: "face-2" },
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
  shotNumber: 1,
  scoreStr: "10",
  scoreInt: 10,
  shooterNumber: 1,
  ...overrides,
});

export const shotCleared = (
  overrides: Partial<Op<"shot.cleared">> = {},
): SyncOperation => ({
  type: "shot.cleared",
  eventId: "e-shot-cleared",
  distanceId: "d-1",
  endNumber: 1,
  shotNumber: 1,
  ...overrides,
});

export const shooterAdded = (
  shooterNumber = 2,
  eventId = "e-shooter-added",
): SyncOperation => ({
  type: "shooter.added",
  eventId,
  roundId: "round-1",
  shooterNumber,
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
  creatorUserId: "user-1",
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

// 作成したばかりのラウンドの射手。作成者`user-1`が射手1の射つ人である。
const creatorShooters: Shooter[] = [
  { shooter_number: 1, user_id: "user-1", role: "owner" },
];

// 取得した状態から作る表。与える行は、全て削除済みでない行である。射手を省くと、作成者の射手1だけにする。
export function roundTablesFromServer(fetched: {
  roundConfig: RoundConfig;
  status: RoundStatus;
  distances: Distance[];
  shots: Shot[];
  shooters?: Shooter[];
}): RoundTables {
  return {
    round: {
      config: fetched.roundConfig,
      status: fetched.status,
      disabled: false,
    },
    shooters: fetched.shooters ?? creatorShooters,
    distances: fetched.distances.map((d) => ({ ...d, disabled: false })),
    shots: fetched.shots.map((s) => ({ ...s, disabled: false })),
  };
}

// 取得したベース。ラウンドの状態と、対象ごとのrevision。
export function roundBase(
  overrides: {
    status?: "in_progress" | "completed";
    name?: string;
    distances?: Distance[];
    shots?: Shot[];
    shooters?: Shooter[];
    revisions?: Partial<RoundRevisions>;
  } = {},
): RoundBaseRecord {
  return {
    tables: roundTablesFromServer({
      status: overrides.status ?? "in_progress",
      roundConfig: {
        name: overrides.name ?? "午前練習",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
      distances: overrides.distances ?? [],
      shots: overrides.shots ?? [],
      shooters: overrides.shooters,
    }),
    revisions: { round: 1, distances: {}, shots: {}, ...overrides.revisions },
  };
}
