const TWO_PI = Math.PI * 2;
const TIDE_PERIOD_MINUTES = 12 * 60 + 25;
const BASE_HIGH = 172;
const BASE_LOW = 48;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function minutesBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nextEvent(now, phaseMinutes, targetPhase) {
  const day = startOfDay(now);
  const base = day.getTime() + (targetPhase - phaseMinutes) * 60000;
  let nearest = new Date(base);

  while (nearest.getTime() - now.getTime() < -TIDE_PERIOD_MINUTES * 30000) {
    nearest = new Date(nearest.getTime() + TIDE_PERIOD_MINUTES * 60000);
  }
  while (nearest.getTime() - now.getTime() > TIDE_PERIOD_MINUTES * 30000) {
    nearest = new Date(nearest.getTime() - TIDE_PERIOD_MINUTES * 60000);
  }
  if (nearest < now) {
    nearest = new Date(nearest.getTime() + TIDE_PERIOD_MINUTES * 60000);
  }
  return nearest;
}

function closestEvent(now, phaseMinutes, targetPhase) {
  const day = startOfDay(now);
  const base = day.getTime() + (targetPhase - phaseMinutes) * 60000;
  const candidates = [-2, -1, 0, 1, 2].map((step) => new Date(base + step * TIDE_PERIOD_MINUTES * 60000));
  return candidates.reduce((best, candidate) => {
    const absMinutes = Math.abs(minutesBetween(candidate, now));
    if (!best || absMinutes < best.absMinutes) {
      return { time: candidate, absMinutes, signedMinutes: minutesBetween(candidate, now) };
    }
    return best;
  }, null);
}

class DemoTideProvider {
  constructor() {
    this.enabled = true;
  }

  setDemoMode(enabled) {
    this.enabled = enabled;
  }

  getCurrentTide(now = new Date()) {
    const day = startOfDay(now);
    const minutes = minutesBetween(now, day);
    const phaseOffset = 118;
    const phaseMinutes = (minutes + phaseOffset) % TIDE_PERIOD_MINUTES;
    const angle = (phaseMinutes / TIDE_PERIOD_MINUTES) * TWO_PI;
    const seasonalLift = Math.sin((day.getDate() / 29.5) * TWO_PI) * 12;
    const tideLevel = Math.round(((Math.cos(angle) + 1) / 2) * (BASE_HIGH - BASE_LOW) + BASE_LOW + seasonalLift);
    const speed = Math.abs(Math.sin(angle));
    const currentSpeed = Number((0.08 + speed * 1.82).toFixed(2));
    const direction = Math.sin(angle) < 0 ? "上潮" : "下潮";
    const highTideTime = nextEvent(now, phaseMinutes, 0);
    const lowTideTime = nextEvent(now, phaseMinutes, TIDE_PERIOD_MINUTES / 2);
    const closestHigh = closestEvent(now, phaseMinutes, 0);
    const closestLow = closestEvent(now, phaseMinutes, TIDE_PERIOD_MINUTES / 2);
    const closest = closestHigh.absMinutes <= closestLow.absMinutes
      ? { type: "満潮", ...closestHigh }
      : { type: "干潮", ...closestLow };
    const tideStill = closest.absMinutes <= 30;
    let tideStillPhase = "none";

    if (tideStill) {
      if (closest.signedMinutes > 10) tideStillPhase = "before";
      else if (closest.signedMinutes >= -10) tideStillPhase = "center";
      else tideStillPhase = "after";
    }

    return {
      demo: this.enabled,
      tideLevel,
      currentSpeed,
      speedNorm: clamp(currentSpeed / 1.9, 0, 1),
      direction,
      highTideTime,
      lowTideTime,
      minutesToHighTide: minutesBetween(highTideTime, now),
      minutesToLowTide: minutesBetween(lowTideTime, now),
      tideStill,
      tideStillPhase,
      closestEvent: { type: closest.type, minutes: closest.absMinutes, signedMinutes: closest.signedMinutes }
    };
  }
}

window.DemoTideProvider = DemoTideProvider;
