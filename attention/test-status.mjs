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
  createPresenceLog,
  isVideoTrackLive,
  ATTENTION_DISCLAIMER,
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
assert.ok(phoneGuide.y2 > phoneGuide.y1, "looking down still has a downward pose arrow");
const phone = classifyPose(phonePose);
assert.equal(phone.away, false, "looking down is not a looking-away alert");
assert.equal(phone.direction, "center");

const screenGlance = classifyPose(estimateAttentionPose(sampleFace({ noseY: 0.57, irisY: 0.417 })));
assert.equal(screenGlance.away, false, "looking at the screen stays attentive");

const notesBesideLaptop = classifyPose(estimateAttentionPose(sampleFace({ irisY: 0.422 })));
assert.equal(notesBesideLaptop.away, false, "a slight look down stays attentive");

const closedLandmarks = sampleFace();
closedLandmarks[159] = { x: 0.43, y: 0.419, z: 0 };
closedLandmarks[145] = { x: 0.43, y: 0.421, z: 0 };
closedLandmarks[386] = { x: 0.57, y: 0.419, z: 0 };
closedLandmarks[374] = { x: 0.57, y: 0.421, z: 0 };
const eyesShut = classifyPose(estimateAttentionPose(closedLandmarks));
assert.equal(eyesShut.away, false, "closed eyes and blinks stay attentive");
assert.equal(eyesShut.direction, "center");

const sideEye = classifyPose(estimateAttentionPose(sampleFace({ irisXShift: 0.015 })));
assert.equal(sideEye.away, false, "iris position alone is not treated as eye tracking");

const turned = classifyPose(estimateAttentionPose(sampleFace({ noseX: 0.56 })));
assert.equal(turned.away, true);
assert.equal(turned.direction, "right");

const tracker = createPoseTracker({ gracePeriodMs: 1200, strongGraceMs: 450, returnGraceMs: 400 });
const brief = tracker.update({ poseAway: true, direction: "left", strong: true, now: 1000 });
assert.equal(brief.confirmedAway, false);
assert.equal(tracker.update({ poseAway: false, direction: "center", strong: false, now: 1200 }).confirmedAway, false);
assert.equal(tracker.summary(1200).totalLookingAwayEvents, 0);

const held = createPoseTracker({ gracePeriodMs: 1200, strongGraceMs: 450, returnGraceMs: 400 });
held.update({ poseAway: true, direction: "left", strong: true, now: 0 });
const confirmed = held.update({ poseAway: true, direction: "left", strong: true, now: 450 });
assert.equal(confirmed.confirmedAway, true);
held.update({ poseAway: false, direction: "center", strong: false, now: 900 });
assert.equal(held.summary(900).events[0].ongoing, true);
held.update({ poseAway: false, direction: "center", strong: false, now: 1300 });
const summary = held.summary(1300);
assert.equal(summary.totalLookingAwayEvents, 1);
assert.equal(summary.events[0].ongoing, false);
assert.equal(summary.events[0].direction, "left");
assert.equal(summary.events[0].durationMs, 1300);
assert.equal(summary.events[0].startIso, new Date(0).toISOString());
assert.equal(summary.events[0].endIso, new Date(1300).toISOString());

const frames = createPoseTracker({ gracePeriodMs: 1200, strongGraceMs: 450, returnGraceMs: 400 });
for (let t = 0; t <= 2000; t += 100) {
  frames.update({ poseAway: true, direction: "right", strong: false, now: t });
}
assert.equal(frames.summary(2000).totalLookingAwayEvents, 1, "one sustained turn is one event");

const signals = createPoseTracker({ gracePeriodMs: 1200, strongGraceMs: 450, returnGraceMs: 400 });
assert.equal(signals.update({ poseAway: true, direction: "left", strong: true, now: 0 }).opened, null);
const opened = signals.update({ poseAway: true, direction: "left", strong: true, now: 450 }).opened;
assert.equal(opened.ongoing, true);
assert.equal(opened.startMs, 0);
assert.equal(signals.update({ poseAway: false, direction: "center", strong: false, now: 500 }).closed, null);
const closed = signals.update({ poseAway: false, direction: "center", strong: false, now: 900 }).closed;
assert.equal(closed.durationMs, 900);
assert.equal(closed.endIso, new Date(900).toISOString());

const once = createPoseTracker({ gracePeriodMs: 1200, strongGraceMs: 450, returnGraceMs: 400 });
once.update({ poseAway: true, direction: "left", strong: true, now: 0 });
once.update({ poseAway: true, direction: "left", strong: true, now: 450 });
const firstClose = once.interrupt(800);
const secondClose = once.interrupt(900);
assert.equal(firstClose.durationMs, 800);
assert.equal(secondClose, null);
assert.equal(once.summary(900).totalLookingAwayEvents, 1);
once.reset();
assert.equal(once.summary(900).totalLookingAwayEvents, 0);
assert.equal(once.summary(900).events.length, 0);

const breakdown = directionBreakdown([
  { direction: "left", durationMs: 1000 },
  { direction: "left", durationMs: 500 },
  { direction: "right", durationMs: 200 },
]);
assert.equal(breakdown[0].label, "Head turned left");
assert.equal(breakdown[0].count, 2);
assert.equal(breakdown[0].durationMs, 1500);
assert.equal(breakdown[1].label, "Head turned right");
assert.equal(breakdown[1].count, 1);

const hidden = createPresenceLog({ graceMs: 1200, returnMs: 400 });
hidden.update({ kind: "face_not_visible", now: 0 });
hidden.update({ kind: "face_not_visible", now: 400 });
assert.equal(hidden.summary(400).faceNotVisible.count, 0, "a brief absence is not an episode");
hidden.update({ kind: "face_not_visible", now: 1200 });
hidden.update({ kind: "face_not_visible", now: 1600 });
assert.equal(hidden.summary(1600).faceNotVisible.count, 1);

const crowd = createPresenceLog({ graceMs: 1000, returnMs: 400 });
crowd.update({ kind: "multiple_faces", now: 0 });
crowd.update({ kind: "multiple_faces", now: 1000 });
crowd.update({ kind: "multiple_faces", now: 1400 });
assert.equal(crowd.summary(1400).multipleFaces.count, 1);

assert.equal(isVideoTrackLive({ readyState: "live", enabled: true }), true);
assert.equal(isVideoTrackLive({ readyState: "ended", enabled: true }), false);
assert.equal(isVideoTrackLive({ readyState: "live", enabled: false }), false);
assert.equal(isVideoTrackLive(null), false);

const dropped = createPresenceLog({ graceMs: 1200, returnMs: 400 });
dropped.update({ kind: "unavailable", now: 1000, immediate: true });
dropped.update({ kind: "unavailable", now: 1500, immediate: true });
dropped.closeAll(4000);
const unavailable = dropped.summary(4000).unavailable;
assert.equal(unavailable.count, 1, "one interruption is one unavailable period");
assert.equal(unavailable.events[0].durationMs, 3000);
assert.equal(dropped.summary(4000).faceNotVisible.count, 0);

const empty = createPresenceLog().summary(0);
assert.equal(empty.faceNotVisible.count, 0);
assert.equal(empty.multipleFaces.count, 0);
assert.equal(empty.unavailable.count, 0);
assert.equal(empty.faceNotVisible.events.length, 0);

assert.equal(ATTENTION_DISCLAIMER.toLowerCase().includes("cheat"), false);
assert.equal(ATTENTION_DISCLAIMER.includes("potential attention change"), true);

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const demoSource = fs.readFileSync(new URL("./demo.html", import.meta.url), "utf8");
assert.equal(appSource.includes("speakAttentionAlert"), false);
assert.equal(appSource.includes("attentionAlertLine"), false);
assert.equal(appSource.includes("lastSpokenAttention"), false);
assert.equal(appSource.includes("speechSynthesis"), false);
assert.equal(demoSource.includes("speechSynthesis"), false);
assert.equal(source.includes("direction: \"closed\""), false);
assert.equal(source.includes("direction: \"down\""), false);

console.log("attention status tests passed");
