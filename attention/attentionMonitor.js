/* ============================================================
   attentionMonitor.js — Attention monitoring

   Reusable browser module for the video interview feature.
   It reads an existing <video> stream. It does not call getUserMedia
   and it does not record, upload, or store video frames.

   Status:
     - one face, facing the screen → ATTENTIVE
     - one face, continuously looking elsewhere → LOOKING_AWAY
     - no face → FACE_NOT_DETECTED
     - two or more → MULTIPLE_FACES
     - no stream / model failure → UNAVAILABLE

   A sustained head turn is a potential attention change, not a verdict.
   Blinks, closed eyes, and looking down stay ATTENTIVE. A short glance
   stays ATTENTIVE. Nothing here is called cheating.
   ============================================================ */

const VISION_VERSION = "0.10.32";
const VISION_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** How often to run detection. */
const FRAME_INTERVAL_MS = 100;
const MAX_INFERENCE_FAILURES = 5;
const POSE_SMOOTHING = 0.45;

/** Head-orientation cutoffs. Gaze and eye closure are not used for alerts. */
export const POSE_THRESHOLDS = Object.freeze({
  yawAway: 0.22,
  pitchDown: 0.78,
  pitchUp: 0.42,
  pitchDepthDown: 0.95,
  gazeDown: 0.5,
  eyeClosed: 0.14,
  gazeUp: 0.3,
  gazeSide: 0.28,
  matrixPitchAway: 30,
  matrixYawAway: 34,
});

const DEFAULT_GRACE_MS = 1200;
const DEFAULT_STRONG_GRACE_MS = 450;
const DEFAULT_RETURN_GRACE_MS = 400;

let enginePromise = null;

function createLandmarker(FaceLandmarker, fileset, delegate) {
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate,
    },
    runningMode: "VIDEO",
    numFaces: 2,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  });
}

/** Download the face model before the camera opens, so detection can start on the first frame. */
export function preloadAttentionEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import(VISION_CDN);
        const fileset = await FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`);
        let landmarker;
        try {
          landmarker = await createLandmarker(FaceLandmarker, fileset, "GPU");
        } catch (gpuError) {
          try {
            landmarker = await createLandmarker(FaceLandmarker, fileset, "CPU");
          } catch (cpuError) {
            gpuError.cause = cpuError;
            throw gpuError;
          }
        }
        return { FaceLandmarker, fileset, landmarker };
      } catch (error) {
        enginePromise = null;
        throw error;
      }
    })();
  }
  return enginePromise;
}

export const AttentionStatus = Object.freeze({
  ATTENTIVE: "ATTENTIVE",
  LOOKING_AWAY: "LOOKING_AWAY",
  FACE_NOT_DETECTED: "FACE_NOT_DETECTED",
  MULTIPLE_FACES: "MULTIPLE_FACES",
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * Face-count status before head pose is applied.
 * A single face is only a candidate for ATTENTIVE; pose can override it.
 */
export function statusFromFaceCount(faceCount) {
  if (!Number.isFinite(faceCount) || faceCount <= 0) {
    return AttentionStatus.FACE_NOT_DETECTED;
  }
  if (faceCount === 1) return AttentionStatus.ATTENTIVE;
  return AttentionStatus.MULTIPLE_FACES;
}

export function messageForStatus(status) {
  switch (status) {
    case AttentionStatus.ATTENTIVE:
      return "Facing the screen.";
    case AttentionStatus.LOOKING_AWAY:
      return "Potential attention change.";
    case AttentionStatus.FACE_NOT_DETECTED:
      return "No face visible.";
    case AttentionStatus.MULTIPLE_FACES:
      return "Multiple faces detected.";
    default:
      return "Attention monitoring is unavailable.";
  }
}

const DIRECTION_LABELS = {
  up: "Head turned up",
  left: "Head turned left",
  right: "Head turned right",
};

export const ATTENTION_DISCLAIMER =
  "Looking away is a potential attention change. It does not prove distraction or dishonesty. These times are measured from the camera. No attention score is calculated.";

/** How many times, and for how long, the person looked each way. */
export function directionBreakdown(events) {
  const groups = new Map();
  for (const event of events || []) {
    const direction = event.direction || "away";
    const row = groups.get(direction) || {
      direction,
      label: DIRECTION_LABELS[direction] || direction,
      count: 0,
      durationMs: 0,
    };
    row.count += 1;
    row.durationMs += event.durationMs || 0;
    groups.set(direction, row);
  }
  return [...groups.values()];
}

export function messageForDirection(direction, pending) {
  const supported = direction === "up" || direction === "left" || direction === "right";
  if (!supported) return "Facing the screen.";
  if (pending) return "Head is turning. Waiting to confirm it is not a brief glance.";
  return "Potential attention change.";
}

/** A video track is usable only while it is live and enabled. */
export function isVideoTrackLive(track) {
  return Boolean(track && track.readyState === "live" && track.enabled !== false);
}

function landmarkAt(landmarks, index) {
  const point = landmarks?.[index];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return point;
}

function eyeOpenRatio(outer, inner, top, bottom) {
  if (!outer || !inner || !top || !bottom) return null;
  const width = Math.hypot(inner.x - outer.x, inner.y - outer.y);
  if (width < 0.004) return null;
  return Math.abs(bottom.y - top.y) / width;
}

function verticalGaze(iris, top, bottom) {
  if (!iris || !top || !bottom) return null;
  const span = bottom.y - top.y;
  if (span < 0.004) return null;
  return (iris.y - top.y) / span;
}

function horizontalGaze(outer, inner, iris) {
  if (!outer || !inner || !iris) return null;
  const width = Math.abs(outer.x - inner.x);
  if (width < 0.004) return null;
  // 0 at the center of the eye, about ±1 when the iris reaches a corner.
  return (iris.x - (outer.x + inner.x) / 2) / (width / 2);
}

function agreedHorizontalGaze(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return right;
  if (right == null) return left;
  const opposed = Math.sign(left) !== Math.sign(right)
    && Math.abs(left) > 0.12
    && Math.abs(right) > 0.12;
  if (opposed) return 0;
  return (left + right) / 2;
}

function average(values) {
  const usable = values.filter((value) => value != null && Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

/**
 * Head direction from face landmarks.
 * pitch ~0.55 and yaw ~0 means facing the camera.
 * pitch rises when the nose drops toward the mouth (looking down at a phone).
 * Returns null when the eyes or nose are missing.
 */
export function estimateAttentionPose(landmarks) {
  const leftOuter = landmarkAt(landmarks, 33);
  const rightOuter = landmarkAt(landmarks, 263);
  const nose = landmarkAt(landmarks, 1);
  const mouthLeft = landmarkAt(landmarks, 61);
  const mouthRight = landmarkAt(landmarks, 291);
  const forehead = landmarkAt(landmarks, 10);
  const chin = landmarkAt(landmarks, 152);
  if (!leftOuter || !rightOuter || !nose || !mouthLeft || !mouthRight) return null;

  const eyeMidX = (leftOuter.x + rightOuter.x) / 2;
  const eyeMidY = (leftOuter.y + rightOuter.y) / 2;
  const eyeDist = Math.hypot(rightOuter.x - leftOuter.x, rightOuter.y - leftOuter.y);
  const mouthMidY = (mouthLeft.y + mouthRight.y) / 2;
  const vertical = mouthMidY - eyeMidY;

  const yaw = eyeDist > 0.001 ? (nose.x - eyeMidX) / eyeDist : 0;
  const pitch = vertical > 0.001 ? (nose.y - eyeMidY) / vertical : 0.55;
  const pitchDepth = forehead && chin && eyeDist > 0.001
    ? ((chin.z ?? 0) - (forehead.z ?? 0)) / eyeDist
    : 0;

  const eyeOpen = average([
    eyeOpenRatio(leftOuter, landmarkAt(landmarks, 133), landmarkAt(landmarks, 159), landmarkAt(landmarks, 145)),
    eyeOpenRatio(rightOuter, landmarkAt(landmarks, 362), landmarkAt(landmarks, 386), landmarkAt(landmarks, 374)),
  ]);
  const gazeY = average([
    verticalGaze(landmarkAt(landmarks, 468), landmarkAt(landmarks, 159), landmarkAt(landmarks, 145)),
    verticalGaze(landmarkAt(landmarks, 473), landmarkAt(landmarks, 386), landmarkAt(landmarks, 374)),
  ]);
  const leftGaze = horizontalGaze(leftOuter, landmarkAt(landmarks, 133), landmarkAt(landmarks, 468));
  const rightGaze = horizontalGaze(rightOuter, landmarkAt(landmarks, 362), landmarkAt(landmarks, 473));
  const gazeX = agreedHorizontalGaze(leftGaze, rightGaze);

  return {
    yaw,
    pitch,
    pitchDepth,
    gazeX: gazeX ?? 0,
    gazeY: gazeY ?? 0.5,
    eyeOpen: eyeOpen ?? 0.3,
    noseX: nose.x,
    noseY: nose.y,
  };
}

/**
 * Short arrow in normalized video space, from the nose toward where the head is pointing.
 * Null until a nose position exists.
 */
export function headPoseGuide(pose) {
  if (!pose || !Number.isFinite(pose.noseX) || !Number.isFinite(pose.noseY)) return null;
  return {
    x1: pose.noseX,
    y1: pose.noseY,
    x2: pose.noseX + pose.yaw * 0.18 + (pose.gazeX || 0) * 0.045,
    y2: pose.noseY + (pose.pitch - 0.55) * 0.22,
  };
}

/** Column-major 4x4 facial matrix → degrees. Null when the matrix is missing. */
export function eulerFromFacialMatrix(matrix) {
  const data = matrix?.data ?? matrix;
  if (!data || data.length < 11) return null;
  const rad = 180 / Math.PI;
  const r00 = data[0];
  const r10 = data[1];
  const r20 = data[2];
  const r21 = data[6];
  const r22 = data[10];
  return {
    pitch: Math.atan2(-r21, Math.hypot(r20, r22)) * rad,
    yaw: Math.atan2(r20, r22) * rad,
    roll: Math.atan2(r10, r00) * rad,
  };
}

export function smoothPose(previous, next) {
  if (!previous) return { ...next };
  if (!next) return null;
  const mix = (from, to) => from + (to - from) * POSE_SMOOTHING;
  return {
    yaw: mix(previous.yaw, next.yaw),
    pitch: mix(previous.pitch, next.pitch),
    pitchDepth: mix(previous.pitchDepth, next.pitchDepth),
    gazeX: mix(previous.gazeX, next.gazeX),
    gazeY: mix(previous.gazeY, next.gazeY),
    eyeOpen: mix(previous.eyeOpen ?? next.eyeOpen, next.eyeOpen),
    noseX: previous.noseX == null ? next.noseX : mix(previous.noseX, next.noseX),
    noseY: previous.noseY == null ? next.noseY : mix(previous.noseY, next.noseY),
    matrixPitch: next.matrixPitch ?? null,
    matrixYaw: next.matrixYaw ?? null,
  };
}

/**
 * Head orientation only. Looking down, closed eyes, and iris position
 * stay attentive. A head turn to the side or up can be looking away.
 */
export function classifyPose(pose, thresholds = POSE_THRESHOLDS) {
  if (!pose) return { away: false, direction: "center", strong: false };

  const lookRight = pose.yaw >= thresholds.yawAway
    || (pose.matrixYaw != null && pose.matrixYaw >= thresholds.matrixYawAway);
  const lookLeft = pose.yaw <= -thresholds.yawAway
    || (pose.matrixYaw != null && pose.matrixYaw <= -thresholds.matrixYawAway);
  const lookUp = pose.pitch <= thresholds.pitchUp
    || (pose.matrixPitch != null && pose.matrixPitch <= -thresholds.matrixPitchAway);

  let direction = "center";
  if (lookLeft) direction = "left";
  else if (lookRight) direction = "right";
  else if (lookUp) direction = "up";

  const away = direction !== "center";
  const strong = away && (
    Math.abs(pose.yaw) >= thresholds.yawAway + 0.1
    || (pose.matrixYaw != null && Math.abs(pose.matrixYaw) >= thresholds.matrixYawAway + 6)
    || (direction === "up" && pose.pitch <= thresholds.pitchUp - 0.06)
  );

  return { away, direction, strong };
}

/**
 * Confirms a head turn only after a continuous grace period.
 * A hard turn confirms faster than a small one. One episode stays one event.
 */
export function createPoseTracker({
  gracePeriodMs = DEFAULT_GRACE_MS,
  strongGraceMs = DEFAULT_STRONG_GRACE_MS,
  returnGraceMs = DEFAULT_RETURN_GRACE_MS,
} = {}) {
  let awaySince = null;
  let backSince = null;
  let confirmedAway = false;
  let activeEvent = null;
  const events = [];

  function present(event) {
    return {
      direction: event.direction,
      startMs: event.startMs,
      endMs: event.endMs,
      durationMs: event.durationMs,
      ongoing: event.ongoing,
      startIso: new Date(event.startMs).toISOString(),
      endIso: event.endMs == null ? null : new Date(event.endMs).toISOString(),
    };
  }

  function closeEvent(now) {
    if (!activeEvent) return null;
    const closed = present({
      direction: activeEvent.direction,
      startMs: activeEvent.startMs,
      endMs: now,
      durationMs: Math.max(0, now - activeEvent.startMs),
      ongoing: false,
    });
    events.push(closed);
    activeEvent = null;
    return closed;
  }

  function update({ poseAway, direction, strong, now }) {
    let opened = null;
    let closed = null;

    if (poseAway) {
      backSince = null;
      if (awaySince == null) awaySince = now;
      const needed = strong ? strongGraceMs : gracePeriodMs;
      if (!confirmedAway && now - awaySince >= needed) {
        confirmedAway = true;
        activeEvent = { startMs: awaySince, direction };
        opened = present({
          direction,
          startMs: awaySince,
          endMs: now,
          durationMs: Math.max(0, now - awaySince),
          ongoing: true,
        });
      }
      if (activeEvent) activeEvent.direction = direction;
    } else if (confirmedAway) {
      awaySince = null;
      if (backSince == null) backSince = now;
      if (now - backSince >= returnGraceMs) {
        closed = closeEvent(now);
        confirmedAway = false;
        backSince = null;
      }
    } else {
      awaySince = null;
      backSince = null;
    }

    return {
      confirmedAway,
      pendingAway: Boolean(poseAway && !confirmedAway),
      direction: poseAway || confirmedAway ? direction : "center",
      awayForMs: awaySince == null ? 0 : now - awaySince,
      opened,
      closed,
    };
  }

  function interrupt(now) {
    const closed = closeEvent(now);
    confirmedAway = false;
    awaySince = null;
    backSince = null;
    return closed;
  }

  function reset() {
    activeEvent = null;
    confirmedAway = false;
    awaySince = null;
    backSince = null;
    events.length = 0;
  }

  function summary(now = Date.now()) {
    const open = activeEvent
      ? [present({
        direction: activeEvent.direction,
        startMs: activeEvent.startMs,
        endMs: now,
        durationMs: Math.max(0, now - activeEvent.startMs),
        ongoing: true,
      })]
      : [];
    const all = events.concat(open);
    return {
      totalLookingAwayEvents: all.length,
      totalLookingAwayMs: all.reduce((sum, event) => sum + event.durationMs, 0),
      events: all,
    };
  }

  return { update, interrupt, reset, summary };
}

const PRESENCE_LABELS = {
  face_not_visible: "Face not visible",
  multiple_faces: "Multiple faces",
  unavailable: "Monitoring unavailable",
};

/**
 * Timed episodes for face absence, extra faces, and camera loss.
 * A brief absence is ignored. An ended camera track is recorded immediately.
 */
export function createPresenceLog({
  graceMs = DEFAULT_GRACE_MS,
  returnMs = DEFAULT_RETURN_GRACE_MS,
} = {}) {
  const events = [];
  let pendingKind = null;
  let pendingSince = null;
  let active = null;
  let clearSince = null;

  function present(kind, startMs, endMs, ongoing) {
    return {
      kind,
      label: PRESENCE_LABELS[kind] || kind,
      startMs,
      endMs,
      durationMs: Math.max(0, endMs - startMs),
      ongoing,
      startIso: new Date(startMs).toISOString(),
      endIso: ongoing ? null : new Date(endMs).toISOString(),
    };
  }

  function close(now) {
    if (!active) return null;
    const closed = present(active.kind, active.startMs, now, false);
    events.push(closed);
    active = null;
    pendingKind = null;
    pendingSince = null;
    clearSince = null;
    return closed;
  }

  function update({ kind = null, now, immediate = false }) {
    if (kind) {
      clearSince = null;
      if (active?.kind === kind) return { opened: null, closed: null };
      const closed = active ? close(now) : null;
      if (pendingKind !== kind) {
        pendingKind = kind;
        pendingSince = now;
      }
      const wait = immediate ? 0 : graceMs;
      if (!active && pendingSince != null && now - pendingSince >= wait) {
        active = { kind, startMs: pendingSince };
        const opened = present(kind, active.startMs, now, true);
        pendingKind = null;
        pendingSince = null;
        return { opened, closed };
      }
      return { opened: null, closed };
    }

    pendingKind = null;
    pendingSince = null;
    if (!active) {
      clearSince = null;
      return { opened: null, closed: null };
    }
    if (clearSince == null) clearSince = now;
    if (now - clearSince >= returnMs) {
      return { opened: null, closed: close(now) };
    }
    return { opened: null, closed: null };
  }

  function reset() {
    events.length = 0;
    active = null;
    pendingKind = null;
    pendingSince = null;
    clearSince = null;
  }

  function summary(now = Date.now()) {
    const open = active ? [present(active.kind, active.startMs, now, true)] : [];
    const all = events.concat(open);
    function group(kind) {
      const rows = all.filter((event) => event.kind === kind);
      return {
        label: PRESENCE_LABELS[kind],
        count: rows.length,
        totalMs: rows.reduce((sum, event) => sum + event.durationMs, 0),
        events: rows,
      };
    }
    return {
      faceNotVisible: group("face_not_visible"),
      multipleFaces: group("multiple_faces"),
      unavailable: group("unavailable"),
    };
  }

  return { update, closeAll: close, reset, summary };
}

/** Normalized box {x, y, width, height} in 0–1 video space, or null. */
export function boundsFromLandmarks(landmarks) {
  if (!landmarks || landmarks.length === 0) return null;

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  const x = clamp01(minX);
  const y = clamp01(minY);
  const right = clamp01(maxX);
  const bottom = clamp01(maxY);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isStreamLive(video) {
  const stream = video?.srcObject;
  if (!stream || typeof stream.getVideoTracks !== "function") return false;
  return stream.getVideoTracks().some((track) => isVideoTrackLive(track));
}

/**
 * @param {object} options
 * @param {HTMLVideoElement} options.video  Playing element with a shared camera stream.
 * @param {(snapshot: object) => void} [options.onFrame]
 * @param {(snapshot: object) => void} [options.onStatusChange]
 * @param {(error: Error) => void} [options.onError]
 * @param {(event: object) => void} [options.onLookingAwayStart]
 * @param {(event: object) => void} [options.onLookingAwayEnd]
 * @param {number} [options.gracePeriodMs] Continuous off-screen look before LOOKING_AWAY.
 * @param {number} [options.strongGraceMs] Faster confirm for a hard head turn.
 * @returns {{ start: () => Promise<object>, stop: () => void, destroy: () => void, getSnapshot: () => object, getSummary: () => object }}
 */
export function createAttentionMonitor({
  video,
  onFrame,
  onStatusChange,
  onError,
  onLookingAwayStart,
  onLookingAwayEnd,
  gracePeriodMs = DEFAULT_GRACE_MS,
  strongGraceMs = DEFAULT_STRONG_GRACE_MS,
  returnGraceMs = DEFAULT_RETURN_GRACE_MS,
} = {}) {
  const tracker = createPoseTracker({ gracePeriodMs, strongGraceMs, returnGraceMs });
  const presence = createPresenceLog({ graceMs: gracePeriodMs, returnMs: returnGraceMs });
  const boundTracks = new Set();
  const state = {
    running: false,
    destroyed: false,
    finalized: false,
    usedCpuFallback: false,
    switchingDelegate: false,
    rafId: 0,
    landmarker: null,
    FaceLandmarker: null,
    fileset: null,
    lastTimestamp: 0,
    lastInferAt: 0,
    failCount: 0,
    pose: null,
    sessionStartedAt: null,
    snapshot: {
      status: AttentionStatus.UNAVAILABLE,
      faceCount: 0,
      boxes: [],
      timestampMs: 0,
      running: false,
      message: "Detection has not started.",
      direction: "center",
      cue: "idle",
      pose: null,
      lifecycle: "idle",
    },
  };

  function onTrackEnded() {
    if (!state.running) return;
    markUnavailable("Camera stream is not available.");
  }

  function bindStream() {
    unbindStream();
    const tracks = video.srcObject?.getVideoTracks?.() ?? [];
    for (const track of tracks) {
      track.addEventListener("ended", onTrackEnded);
      boundTracks.add(track);
    }
  }

  function unbindStream() {
    for (const track of boundTracks) {
      track.removeEventListener("ended", onTrackEnded);
    }
    boundTracks.clear();
  }

  function haltLoop() {
    state.running = false;
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    unbindStream();
  }

  function markUnavailable(message) {
    const now = Date.now();
    const closed = tracker.interrupt(now);
    if (closed) onLookingAwayEnd?.(closed);
    presence.update({ kind: "unavailable", now, immediate: true });
    state.pose = null;
    haltLoop();
    publish({
      status: AttentionStatus.UNAVAILABLE,
      faceCount: 0,
      boxes: [],
      message,
      cue: "idle",
    });
  }

  function publish({ status, faceCount, boxes, message, direction = "center", cue = "idle", pose = null }) {
    const previous = state.snapshot.status;
    state.snapshot = {
      status,
      faceCount,
      boxes,
      timestampMs: Date.now(),
      running: state.running,
      message,
      direction,
      cue,
      pose,
      lifecycle: state.running ? "running" : "released",
    };
    onFrame?.(state.snapshot);
    if (status !== previous) onStatusChange?.(state.snapshot);
  }

  function nextTimestamp() {
    const now = Math.round(performance.now());
    state.lastTimestamp = now <= state.lastTimestamp ? state.lastTimestamp + 1 : now;
    return state.lastTimestamp;
  }

  async function ensureLandmarker() {
    if (state.landmarker) return state.landmarker;
    const engine = await preloadAttentionEngine();
    if (state.destroyed) return null;
    state.FaceLandmarker = engine.FaceLandmarker;
    state.fileset = engine.fileset;
    state.landmarker = engine.landmarker;
    return state.landmarker;
  }

  async function switchToCpu() {
    state.landmarker?.close?.();
    state.landmarker = null;
    const created = await createLandmarker(state.FaceLandmarker, state.fileset, "CPU");
    if (state.destroyed || !state.running) {
      created.close?.();
      return;
    }
    state.landmarker = created;
  }

  function tick(now) {
    if (!state.running) return;
    state.rafId = requestAnimationFrame(tick);
    if (state.switchingDelegate) return;

    if (now - state.lastInferAt < FRAME_INTERVAL_MS) return;
    state.lastInferAt = now;

    if (!isStreamLive(video)) {
      markUnavailable("Camera stream is not available.");
      return;
    }

    if (video.readyState < 2 || video.videoWidth === 0) return;

    try {
      const result = state.landmarker.detectForVideo(video, nextTimestamp());
      const faces = result?.faceLandmarks ?? [];
      const boxes = [];
      for (const landmarks of faces) {
        const box = boundsFromLandmarks(landmarks);
        if (box) boxes.push(box);
      }
      const faceCount = faces.length;
      const now = Date.now();
      let status = statusFromFaceCount(faceCount);
      let message = messageForStatus(status);
      let direction = "center";
      let cue = status === AttentionStatus.ATTENTIVE ? "ok" : "warn";
      let pose = null;

      if (faceCount === 1) {
        const raw = estimateAttentionPose(faces[0]);
        const angles = eulerFromFacialMatrix(result.facialTransformationMatrixes?.[0]);
        if (raw && angles) {
          raw.matrixPitch = angles.pitch;
          raw.matrixYaw = angles.yaw;
        }
        state.pose = smoothPose(state.pose, raw);
        pose = state.pose;
        const judged = classifyPose(pose);
        presence.update({ kind: null, now });
        const tracked = tracker.update({
          poseAway: judged.away,
          direction: judged.direction,
          strong: judged.strong,
          now,
        });
        if (tracked.opened) onLookingAwayStart?.(tracked.opened);
        if (tracked.closed) onLookingAwayEnd?.(tracked.closed);
        direction = tracked.direction;
        if (tracked.confirmedAway) {
          status = AttentionStatus.LOOKING_AWAY;
          message = messageForDirection(tracked.direction, false);
          cue = "away";
        } else if (tracked.pendingAway) {
          message = messageForDirection(tracked.direction, true);
          cue = "warn";
        } else {
          message = "Facing the screen.";
          cue = "ok";
        }
      } else {
        state.pose = null;
        const closed = tracker.interrupt(now);
        if (closed) onLookingAwayEnd?.(closed);
        presence.update({
          kind: faceCount === 0 ? "face_not_visible" : "multiple_faces",
          now,
        });
      }

      publish({ status, faceCount, boxes, message, direction, cue, pose });
      state.failCount = 0;
    } catch (error) {
      state.failCount += 1;
      if (state.failCount < MAX_INFERENCE_FAILURES) return;
      if (!state.usedCpuFallback) {
        state.usedCpuFallback = true;
        state.failCount = 0;
        state.switchingDelegate = true;
        switchToCpu()
          .catch((cpuError) => {
            onError?.(cpuError instanceof Error ? cpuError : new Error(String(cpuError)));
            markUnavailable("Face detection stopped working.");
          })
          .finally(() => {
            state.switchingDelegate = false;
          });
        return;
      }
      onError?.(error instanceof Error ? error : new Error(String(error)));
      markUnavailable("Face detection stopped working.");
    }
  }

  async function start() {
    if (state.destroyed) {
      throw new Error("This attention monitor was destroyed. Create a new one.");
    }
    if (!video || video.nodeName !== "VIDEO") {
      throw new Error("createAttentionMonitor requires a <video> element.");
    }
    if (state.running) return state.snapshot;
    if (!isStreamLive(video)) {
      const error = new Error(
        "No live video stream. Pass a playing video element that already has a camera stream."
      );
      publish({
        status: AttentionStatus.UNAVAILABLE,
        faceCount: 0,
        boxes: [],
        message: "Camera stream is not available.",
      });
      onError?.(error);
      throw error;
    }

    state.running = true;
    state.finalized = false;
    state.failCount = 0;
    state.pose = null;
    state.sessionStartedAt = Date.now();
    state.sessionEndedAt = null;
    tracker.reset();
    presence.reset();
    bindStream();
    let landmarker;
    try {
      landmarker = await ensureLandmarker();
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      markUnavailable("Face detection model could not be loaded.");
      onError?.(wrapped);
      throw wrapped;
    }

    if (!landmarker || !state.running) {
      state.running = false;
      return state.snapshot;
    }
    state.rafId = requestAnimationFrame(tick);
    return state.snapshot;
  }

  function stop() {
    haltLoop();
    if (!state.finalized) {
      state.finalized = true;
      state.sessionEndedAt = Date.now();
      const closed = tracker.interrupt(state.sessionEndedAt);
      if (closed) onLookingAwayEnd?.(closed);
      presence.closeAll(state.sessionEndedAt);
    }
    state.snapshot = { ...state.snapshot, running: false, lifecycle: "released" };
  }

  function destroy() {
    if (state.destroyed) {
      stop();
      return;
    }
    state.destroyed = true;
    stop();
    state.landmarker = null;
  }

  function getSnapshot() {
    return {
      ...state.snapshot,
      boxes: state.snapshot.boxes.map((box) => ({ ...box })),
      pose: state.snapshot.pose ? { ...state.snapshot.pose } : null,
    };
  }

  function getSummary() {
    const now = state.sessionEndedAt || Date.now();
    const report = tracker.summary(now);
    const presenceReport = presence.summary(now);
    const totalMonitoringMs = state.sessionStartedAt
      ? Math.max(0, now - state.sessionStartedAt)
      : 0;
    return {
      ...report,
      finalStatus: state.snapshot.status,
      sessionStartedAtMs: state.sessionStartedAt,
      sessionStartedAtIso: state.sessionStartedAt
        ? new Date(state.sessionStartedAt).toISOString()
        : null,
      sessionEndedAtMs: state.sessionEndedAt,
      totalMonitoringMs,
      disclaimer: ATTENTION_DISCLAIMER,
      byDirection: directionBreakdown(report.events),
      measured: {
        totalMonitoringMs,
        lookingAway: {
          label: "Potential attention change",
          count: report.totalLookingAwayEvents,
          totalMs: report.totalLookingAwayMs,
          events: report.events,
        },
        faceNotVisible: presenceReport.faceNotVisible,
        multipleFaces: presenceReport.multipleFaces,
        unavailable: presenceReport.unavailable,
      },
      estimates: [],
    };
  }

  return { start, stop, destroy, getSnapshot, getSummary };
}

if (typeof window !== "undefined") {
  window.AttentionMonitor = {
    createAttentionMonitor,
    preloadAttentionEngine,
    AttentionStatus,
    statusFromFaceCount,
    boundsFromLandmarks,
    messageForStatus,
    estimateAttentionPose,
    classifyPose,
    createPoseTracker,
  };
}
