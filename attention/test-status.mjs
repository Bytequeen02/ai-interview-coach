import assert from "node:assert/strict";
import fs from "node:fs";
import {
  AttentionStatus,
  statusFromFaceCount,
  boundsFromLandmarks,
  messageForStatus,
  estimateAttentionPose,
  classifyPose,
  createPoseTracker,
  headPoseGuide,
  directionBreakdown,
} from "./attentionMonitor.js";

assert.equal(statusFromFaceCount(0), AttentionStatus.FACE_NOT_DETECTED);
assert.equal(statusFromFaceCount(-1), AttentionStatus.FACE_NOT_DETECTED);
assert.equal(statusFromFaceCount(Number.NaN), AttentionStatus.FACE_NOT_DETECTED);
assert.equal(statusFromFaceCount(1), AttentionStatus.ATTENTIVE);
assert.equal(statusFromFaceCount(2), AttentionStatus.MULTIPLE_FACES);
assert.equal(statusFromFaceCount(4), AttentionStatus.MULTIPLE_FACES);

assert.equal(boundsFromLandmarks([]), null);
assert.equal(boundsFromLandmarks(null), null);

const box = boundsFromLandmarks([
  { x: 0.2, y: 0.3 },
  { x: 0.5, y: 0.8 },
  { x: -0.2, y: 1.4 },
]);
assert.deepEqual(box, { x: 0, y: 0.3, width: 0.5, height: 0.7 });

assert.equal(messageForStatus(AttentionStatus.FACE_NOT_DETECTED), "No face visible.");
assert.equal(messageForStatus(AttentionStatus.MULTIPLE_FACES), "Multiple faces detected.");
assert.equal(messageForStatus(AttentionStatus.ATTENTIVE).toLowerCase().includes("cheat"), false);

const source = fs.readFileSync(new URL("./attentionMonitor.js", import.meta.url), "utf8");
assert.equal(/getUserMedia\s*\(/.test(source), false);
assert.equal(/mediaDevices/.test(source), false);
assert.equal(source.toLowerCase().includes("cheating detected"), false);

function face(points) {
  const landmarks = [];
  for (const [index, point] of Object.entries(points)) {
    landmarks[Number(index)] = point;
  }
  return landmarks;
}

function sampleFace({ noseY = 0.55, noseX = 0.5, irisY = 0.417, irisXShift = 0 } = {}) {
  return face({
    10: { x: 0.5, y: 0.3, z: 0 },
    33: { x: 0.4, y: 0.42, z: 0 },
    133: { x: 0.46, y: 0.42, z: 0 },
    159: { x: 0.43, y: 0.4, z: 0 },
    145: { x: 0.43, y: 0.44, z: 0 },
    468: { x: 0.43 + irisXShift, y: irisY, z: 0 },
    263: { x: 0.6, y: 0.42, z: 0 },
    362: { x: 0.54, y: 0.42, z: 0 },
    386: { x: 0.57, y: 0.4, z: 0 },
    374: { x: 0.57, y: 0.44, z: 0 },
    473: { x: 0.57 + irisXShift, y: irisY, z: 0 },
    1: { x: noseX, y: noseY, z: -0.03 },
    61: { x: 0.45, y: 0.64, z: 0 },
    291: { x: 0.55, y: 0.64, z: 0 },
    152: { x: 0.5, y: 0.78, z: 0.02 },
  });
}

const facingPose = estimateAttentionPose(sampleFace());
const facing = classifyPose(facingPose);
assert.equal(facing.away, false, "screen-facing pose should stay attentive");
const facingGuide = headPoseGuide(facingPose);
assert.ok(Math.abs(facingGuide.x2 - facingGuide.x1) < 0.02);
assert.ok(facingGuide.y2 > facingGuide.y1 - 0.05);

const phonePose = estimateAttentionPose(sampleFace({ noseY: 0.62, irisY: 0.435 }));
const phoneGuide = headPoseGuide(phonePose);
assert.ok(phoneGuide.y2 > phoneGuide.y1, "looking down points the arrow downward");

const phone = classifyPose(estimateAttentionPose(sampleFace({ noseY: 0.62, irisY: 0.435 })));
assert.equal(phone.away, true);
assert.equal(phone.direction, "down");
assert.equal(phone.strong, true);

const screenGlance = classifyPose(estimateAttentionPose(sampleFace({ noseY: 0.57, irisY: 0.417 })));
assert.equal(screenGlance.away, false, "looking at the screen stays attentive");

const notesBesideLaptop = classifyPose(estimateAttentionPose(sampleFace({ irisY: 0.422 })));
assert.equal(notesBesideLaptop.away, true, "a slight look down should count");
assert.equal(notesBesideLaptop.direction, "down");

const closedLandmarks = sampleFace();
closedLandmarks[159] = { x: 0.43, y: 0.419, z: 0 };
closedLandmarks[145] = { x: 0.43, y: 0.421, z: 0 };
closedLandmarks[386] = { x: 0.57, y: 0.419, z: 0 };
closedLandmarks[374] = { x: 0.57, y: 0.421, z: 0 };
const eyesShut = classifyPose(estimateAttentionPose(closedLandmarks));
assert.equal(eyesShut.away, true, "closed eyes should not stay attentive");
assert.equal(eyesShut.direction, "closed");

const sideEye = classifyPose(estimateAttentionPose(sampleFace({ irisXShift: 0.015 })));
assert.equal(sideEye.away, true, "eyes to the side should count even when the head stays forward");
assert.ok(sideEye.direction === "left" || sideEye.direction === "right");

const turned = classifyPose(estimateAttentionPose(sampleFace({ noseX: 0.56 })));
assert.equal(turned.away, true);
assert.equal(turned.direction, "right");

const tracker = createPoseTracker({ gracePeriodMs: 1200, strongGraceMs: 450, returnGraceMs: 400 });
const brief = tracker.update({ poseAway: true, direction: "down", strong: true, now: 1000 });
assert.equal(brief.confirmedAway, false);
assert.equal(tracker.update({ poseAway: false, direction: "center", strong: false, now: 1200 }).confirmedAway, false);
assert.equal(tracker.summary(1200).totalLookingAwayEvents, 0);

const held = createPoseTracker({ gracePeriodMs: 1200, strongGraceMs: 450, returnGraceMs: 400 });
held.update({ poseAway: true, direction: "down", strong: true, now: 0 });
const confirmed = held.update({ poseAway: true, direction: "down", strong: true, now: 450 });
assert.equal(confirmed.confirmedAway, true);
held.update({ poseAway: false, direction: "center", strong: false, now: 900 });
assert.equal(held.summary(900).events[0].ongoing, true);
held.update({ poseAway: false, direction: "center", strong: false, now: 1300 });
const summary = held.summary(1300);
assert.equal(summary.totalLookingAwayEvents, 1);
assert.equal(summary.events[0].ongoing, false);
assert.equal(summary.events[0].direction, "down");
assert.equal(summary.events[0].durationMs, 1300);
assert.equal(summary.events[0].startIso, new Date(0).toISOString());
assert.equal(summary.events[0].endIso, new Date(1300).toISOString());
assert.equal(summary.events[0].ongoing, false);

const signals = createPoseTracker({ gracePeriodMs: 1200, strongGraceMs: 450, returnGraceMs: 400 });
assert.equal(signals.update({ poseAway: true, direction: "down", strong: true, now: 0 }).opened, null);
const opened = signals.update({ poseAway: true, direction: "down", strong: true, now: 450 }).opened;
assert.equal(opened.ongoing, true);
assert.equal(opened.startMs, 0);
assert.equal(signals.update({ poseAway: false, direction: "center", strong: false, now: 500 }).closed, null);
const closed = signals.update({ poseAway: false, direction: "center", strong: false, now: 900 }).closed;
assert.equal(closed.durationMs, 900);
assert.equal(closed.endIso, new Date(900).toISOString());

const once = createPoseTracker({ gracePeriodMs: 1200, strongGraceMs: 450, returnGraceMs: 400 });
once.update({ poseAway: true, direction: "down", strong: true, now: 0 });
once.update({ poseAway: true, direction: "down", strong: true, now: 450 });
const firstClose = once.interrupt(800);
const secondClose = once.interrupt(900);
assert.equal(firstClose.durationMs, 800);
assert.equal(secondClose, null);
assert.equal(once.summary(900).totalLookingAwayEvents, 1);
once.reset();
assert.equal(once.summary(900).totalLookingAwayEvents, 0);

const breakdown = directionBreakdown([
  { direction: "down", durationMs: 1000 },
  { direction: "down", durationMs: 500 },
  { direction: "left", durationMs: 200 },
]);
assert.equal(breakdown[0].label, "Looked down");
assert.equal(breakdown[0].count, 2);
assert.equal(breakdown[0].durationMs, 1500);
assert.equal(breakdown[1].label, "Looked left");
assert.equal(breakdown[1].count, 1);

console.log("attention status tests passed");
