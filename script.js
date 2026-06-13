const AppAudioEngine = window.AudioEngine;
const APP_SOUND_SOURCES = window.SOUND_SOURCES;
const AppDemoTideProvider = window.DemoTideProvider;
const appFallbackWeather = window.fallbackWeather;
const appFetchWeather = window.fetchWeather;
const tideProvider = new AppDemoTideProvider();
const audioEngine = new AppAudioEngine();
const appState = {
  weather: appFallbackWeather(),
  location: {
    name: "Tokyo, Japan",
    latitude: 35.6355,
    longitude: 139.7407
  },
  environmentMode: "automatic",
  simulation: {
    timeBand: "Afternoon",
    tide: "ebb",
    weather: "晴れ",
    temperature: 27
  },
  isPlaying: false,
  masterPercent: 100,
  layerPercents: { PAD: 100, LINE: 100, DOT: 100 },
  sourcePercents: {}
};

const $ = (selector) => document.querySelector(selector);
const volumeSettings = $("#volumeSettings");
const advancedVolumeSettings = $("#advancedVolumeSettings");
const btnFullscreen = $("#btnFullscreen");
const BASE_MASTER_DB = -14;
const BASE_SOURCE_VOLUMES = Object.fromEntries(APP_SOUND_SOURCES.map((source) => [source.id, source.volume]));
const LOCATION_PRESETS = {
  tokyo: { name: "Tokyo, Japan", latitude: 35.6355, longitude: 139.7407 },
  osaka: { name: "Osaka, Japan", latitude: 34.6937, longitude: 135.5023 },
  sapporo: { name: "Sapporo, Japan", latitude: 43.0618, longitude: 141.3545 },
  fukuoka: { name: "Fukuoka, Japan", latitude: 33.5902, longitude: 130.4017 }
};
const SOUND_GROUPS = {
  afterglow: { id: "sound-afterglow", sources: ["dreamPad"] },
  flow: { id: "sound-flow", sources: ["ambientPiano", "glassBell"] },
  sparkle: { id: "sound-sparkle", sources: ["glockenspiel", "crystalAccent"] },
  particle: { id: "sound-particle", sources: ["marimba", "woodBlock"] },
  fluctuation: { id: "sound-fluctuation", sources: ["analogPad", "brushedMetal"] }
};
const SOURCE_TO_GROUP = Object.fromEntries(
  Object.entries(SOUND_GROUPS).flatMap(([group, spec]) => spec.sources.map((source) => [source, group]))
);
const activeSources = new Set();
const activeGroups = new Set();
const WEATHER_REFRESH_MS = 60 * 1000;
let lastEnvTextUpdate = 0;
let lastWeatherFetchAt = 0;
let weatherUpdateInFlight = false;

APP_SOUND_SOURCES.forEach((source) => {
  appState.sourcePercents[source.id] = 100;
});

function getTimeBand(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 7 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 18) return "Afternoon";
  if (hour >= 18) return "Evening";
  return "Night";
}

function formatMinutes(minutes) {
  if (minutes < 0) return "まもなく";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

function volumePercentToDb(baseDb, percent) {
  if (Number(percent) <= 0) return -80;
  return baseDb + 20 * Math.log10(Number(percent) / 100);
}

function updatePlaybackUi() {
  document.body.classList.toggle("is-playing", appState.isPlaying);
  $("#playbackStatus").textContent = "";
  $("#playbackStatus").dataset.label = appState.isPlaying ? "Playing" : "Tap to begin";
}

function renderSettings() {
  const layerRows = ["PAD", "LINE", "DOT"].map((layer) => `
    <label class="range-row">
      <span>${layer}音量 <b data-percent-label="layer-${layer}">100%</b></span>
      <input type="range" min="0" max="100" value="100" step="1" data-layer-volume="${layer}" />
    </label>
  `).join("");
  const sourceRows = APP_SOUND_SOURCES.map((source) => `
    <label class="range-row">
      <span>${source.name} <b data-percent-label="${source.id}">100%</b></span>
      <input type="range" min="0" max="100" value="100" step="1" data-source-volume="${source.id}" />
    </label>
    <label class="toggle-row">
      <span>${source.name}をミュート</span>
      <input type="checkbox" data-mute="${source.id}" />
    </label>
  `).join("");

  volumeSettings.innerHTML = layerRows;
  advancedVolumeSettings.innerHTML = sourceRows;
}

function applySourceVolume(id) {
  const source = APP_SOUND_SOURCES.find((item) => item.id === id);
  if (!source) return;
  const layerPercent = appState.layerPercents[source.layer] ?? 100;
  const sourcePercent = appState.sourcePercents[id] ?? 100;
  const combined = (layerPercent * sourcePercent) / 100;
  audioEngine.setSourceVolume(id, volumePercentToDb(BASE_SOURCE_VOLUMES[id], combined));
}

function applyAllSourceVolumes() {
  APP_SOUND_SOURCES.forEach((source) => applySourceVolume(source.id));
}

function setTextIfChanged(el, nextText) {
  if (el && el.textContent !== nextText) el.textContent = nextText;
}

function getCheckedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function setSimulationEnabled(enabled) {
  const panel = $("#simulationPanel");
  if (!panel) return;
  panel.hidden = !enabled;
  panel.setAttribute("aria-disabled", String(!enabled));
  panel.querySelectorAll("input").forEach((input) => {
    input.disabled = !enabled;
  });
}

function updateLocationUi() {
  setTextIfChanged($("#locationSummary"), appState.location.name);
  const locationName = $("#locationName");
  if (locationName) locationName.value = appState.location.name;
  const latitude = $("#latitude");
  const longitude = $("#longitude");
  if (latitude) latitude.value = appState.location.latitude;
  if (longitude) longitude.value = appState.location.longitude;
}

function applyLocationPreset(value) {
  if (!LOCATION_PRESETS[value]) return;
  appState.location = { ...LOCATION_PRESETS[value] };
  updateLocationUi();
  updateWeather({ force: true });
}

function updateSimulationState() {
  appState.environmentMode = getCheckedValue("environmentMode") || "automatic";
  appState.simulation = {
    timeBand: getCheckedValue("simulationTime") || "Afternoon",
    tide: getCheckedValue("simulationTide") || "ebb",
    weather: getCheckedValue("simulationWeather") || "晴れ",
    temperature: Number($("#simulationTemperature")?.value || 27)
  };
  setTextIfChanged($("#simulationTemperatureValue"), `${appState.simulation.temperature}℃`);
  setSimulationEnabled(appState.environmentMode === "simulation");
  lastEnvTextUpdate = 0;
  if (appState.environmentMode === "automatic") {
    updateWeather({ force: true });
  } else {
    tick();
  }
}

function createSimulationWeather() {
  const weather = appState.simulation.weather;
  const storm = weather === "嵐";
  const rain = weather === "雨" || storm;
  const cloudy = weather === "曇り";
  return {
    weather: rain ? "雨" : cloudy ? "曇り" : "晴れ",
    weatherCode: storm ? 82 : rain ? 61 : cloudy ? 3 : 1,
    temperature: appState.simulation.temperature,
    humidity: storm ? 88 : rain ? 84 : cloudy ? 70 : 58,
    windSpeed: storm ? 10.8 : rain ? 5.4 : cloudy ? 4.2 : 2.1,
    source: "Simulation"
  };
}

function createSimulationTide() {
  const tide = appState.simulation.tide;
  const presets = {
    rising: { tideLevel: 118, currentSpeed: 1.62, speedNorm: 0.85, direction: "上潮", tideStill: false, tideStillPhase: "none", minutesToHighTide: 92, minutesToLowTide: 456 },
    ebb: { tideLevel: 96, currentSpeed: 1.54, speedNorm: 0.81, direction: "下潮", tideStill: false, tideStillPhase: "none", minutesToHighTide: 284, minutesToLowTide: 86 },
    high: { tideLevel: 172, currentSpeed: 0.12, speedNorm: 0.06, direction: "下潮", tideStill: true, tideStillPhase: "center", minutesToHighTide: 0, minutesToLowTide: 372 },
    low: { tideLevel: 48, currentSpeed: 0.12, speedNorm: 0.06, direction: "上潮", tideStill: true, tideStillPhase: "center", minutesToHighTide: 372, minutesToLowTide: 0 },
    slack: { tideLevel: 108, currentSpeed: 0.08, speedNorm: 0.04, direction: "下潮", tideStill: true, tideStillPhase: "center", minutesToHighTide: 186, minutesToLowTide: 186 }
  };
  const selected = presets[tide] || presets.ebb;
  return {
    ...selected,
    demo: true,
    highTideTime: new Date(Date.now() + selected.minutesToHighTide * 60000),
    lowTideTime: new Date(Date.now() + selected.minutesToLowTide * 60000),
    closestEvent: { type: tide === "low" ? "干潮" : "満潮", minutes: 0, signedMinutes: 0 }
  };
}

function renderActiveElements() {
  Object.entries(SOUND_GROUPS).forEach(([group, spec]) => {
    const el = document.getElementById(spec.id);
    if (!el) return;
    const active = activeGroups.has(group);
    if (el.classList.contains("active") !== active) {
      el.classList.toggle("active", active);
    }
  });
}

function clearActiveElements() {
  activeSources.clear();
  activeGroups.clear();
  renderActiveElements();
}

function updateEnvValue(id, nextText) {
  const value = document.querySelector(`#${id} strong`);
  setTextIfChanged(value, nextText);
}

function updateEnvironmentText(environment, tide, force = false) {
  const now = Date.now();
  if (!force && now - lastEnvTextUpdate < 10000) return;
  lastEnvTextUpdate = now;
  setTextIfChanged($("#timeBand"), environment.timeBand);
  setTextIfChanged($("#weather"), environment.weather.weather);
  updateEnvValue("tideLevel", `${tide.tideLevel}cm`);
  updateEnvValue("temperature", `${environment.weather.temperature}℃`);
  updateEnvValue("humidity", `${environment.weather.humidity}%`);
  updateEnvValue("windSpeed", `${Number(environment.weather.windSpeed || 0).toFixed(1)}m/s`);
}

function updateFullscreenButton() {
  if (!btnFullscreen) return;
  const isFullscreen = Boolean(document.fullscreenElement);
  btnFullscreen.textContent = isFullscreen ? "×" : "⛶";
  btnFullscreen.setAttribute("aria-label", isFullscreen ? "Exit fullscreen" : "Enter fullscreen");
}

async function toggleFullscreen() {
  if (!btnFullscreen) return;
  try {
    if (!document.fullscreenElement) {
      if (!document.documentElement.requestFullscreen) {
        console.warn("Fullscreen is not available in this browser.");
        return;
      }
      await document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
    updateFullscreenButton();
  } catch (error) {
    console.warn("Fullscreen is not available:", error);
  }
}

function bindControls() {
  $("#playButton").addEventListener("click", async () => {
    if (appState.isPlaying) {
      audioEngine.stop();
      appState.isPlaying = false;
      clearActiveElements();
      updatePlaybackUi();
      return;
    }
    try {
      await audioEngine.start();
      appState.isPlaying = true;
      updatePlaybackUi();
      tick();
    } catch (error) {
      $("#playbackStatus").textContent = "";
      $("#playbackStatus").dataset.label = "Unavailable";
      console.error(error);
    }
  });

  $("#stopButton").addEventListener("click", () => {
    audioEngine.stop();
    appState.isPlaying = false;
    clearActiveElements();
    updatePlaybackUi();
  });

  if (btnFullscreen) {
    btnFullscreen.addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    updateFullscreenButton();
  }

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("is-active", item === button));
      document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("is-active", screen.dataset.screen === button.dataset.target));
    });
  });

  $("#detailsToggle").addEventListener("click", () => {
    const panel = $("#advancedSettings");
    const nextOpen = panel.hidden;
    panel.hidden = !nextOpen;
    $("#detailsToggle").setAttribute("aria-expanded", String(nextOpen));
    $("#detailsToggle").textContent = nextOpen ? "×" : "•••";
  });

  $("#masterVolume").addEventListener("input", (event) => {
    appState.masterPercent = Number(event.target.value);
    $("#masterVolumeValue").textContent = `${appState.masterPercent}%`;
    audioEngine.setMasterVolume(volumePercentToDb(BASE_MASTER_DB, appState.masterPercent));
  });
  $("#reverbAmount").addEventListener("input", (event) => {
    $("#reverbValue").textContent = `${Math.round(Number(event.target.value) * 100)}%`;
    audioEngine.setReverbAmount(event.target.value);
  });
  $("#lowpass").addEventListener("input", (event) => {
    $("#lowpassValue").textContent = `${event.target.value}Hz`;
    audioEngine.setLowpass(event.target.value);
  });
  $("#tremoloAmount").addEventListener("input", (event) => {
    $("#tremoloValue").textContent = `${Math.round(Number(event.target.value) * 100)}%`;
    audioEngine.setTremoloAmount(event.target.value);
  });
  $("#demoTideMode").addEventListener("change", (event) => tideProvider.setDemoMode(event.target.checked));
  $("#refreshWeather").addEventListener("click", () => updateWeather({ force: true }));
  $("#resetSettings").addEventListener("click", resetSettings);

  document.querySelectorAll('input[name="locationPreset"]').forEach((input) => {
    input.addEventListener("change", (event) => applyLocationPreset(event.target.value));
  });

  document.querySelectorAll('input[name="environmentMode"], input[name="simulationTime"], input[name="simulationTide"], input[name="simulationWeather"]').forEach((input) => {
    input.addEventListener("change", updateSimulationState);
  });
  $("#simulationTemperature").addEventListener("input", updateSimulationState);

  document.addEventListener("input", (event) => {
    const sourceId = event.target.dataset.sourceVolume;
    const layer = event.target.dataset.layerVolume;
    if (sourceId) {
      appState.sourcePercents[sourceId] = Number(event.target.value);
      document.querySelector(`[data-percent-label="${sourceId}"]`).textContent = `${event.target.value}%`;
      applySourceVolume(sourceId);
    }
    if (layer) {
      appState.layerPercents[layer] = Number(event.target.value);
      document.querySelector(`[data-percent-label="layer-${layer}"]`).textContent = `${event.target.value}%`;
      applyAllSourceVolumes();
    }
  });

  document.addEventListener("change", (event) => {
    const muteId = event.target.dataset.mute;
    if (muteId) audioEngine.setMuted(muteId, event.target.checked);
  });

  window.addEventListener("source-activity", (event) => {
    const { id, active } = event.detail;
    const group = SOURCE_TO_GROUP[id];
    if (!group) return;
    if (active) {
      activeSources.add(id);
    } else {
      activeSources.delete(id);
    }
    const groupActive = SOUND_GROUPS[group].sources.some((source) => activeSources.has(source));
    if (groupActive) activeGroups.add(group);
    else activeGroups.delete(group);
    renderActiveElements();
  });
}

function resetSettings() {
  appState.masterPercent = 100;
  appState.layerPercents = { PAD: 100, LINE: 100, DOT: 100 };
  APP_SOUND_SOURCES.forEach((source) => {
    appState.sourcePercents[source.id] = 100;
    audioEngine.setMuted(source.id, false);
  });

  $("#masterVolume").value = 100;
  $("#masterVolumeValue").textContent = "100%";
  document.querySelectorAll("[data-layer-volume], [data-source-volume]").forEach((input) => {
    input.value = 100;
  });
  document.querySelectorAll("[data-percent-label]").forEach((label) => {
    label.textContent = "100%";
  });
  document.querySelectorAll("[data-mute]").forEach((input) => {
    input.checked = false;
  });
  audioEngine.setMasterVolume(BASE_MASTER_DB);
  applyAllSourceVolumes();
}

async function updateWeather({ force = false } = {}) {
  if (appState.environmentMode !== "automatic") {
    tick();
    return;
  }
  const now = Date.now();
  if (weatherUpdateInFlight || (!force && now - lastWeatherFetchAt < WEATHER_REFRESH_MS)) {
    return;
  }
  weatherUpdateInFlight = true;
  const note = $("#weatherNote");
  note.textContent = "天気を取得中...";
  try {
    appState.weather = await appFetchWeather(appState.location);
    note.textContent = `${appState.weather.source} から取得しました。`;
  } catch (error) {
    appState.weather = appFallbackWeather();
    note.textContent = "取得できなかったため、デモ天気に切り替えました。";
  } finally {
    lastWeatherFetchAt = Date.now();
    weatherUpdateInFlight = false;
  }
  lastEnvTextUpdate = 0;
  tick();
}

function tick() {
  const now = new Date();
  const simulation = appState.environmentMode === "simulation";
  const tide = simulation ? createSimulationTide() : tideProvider.getCurrentTide(now);
  const weather = simulation ? createSimulationWeather() : appState.weather;
  const environment = {
    timeBand: simulation ? appState.simulation.timeBand : getTimeBand(now),
    tide,
    weather,
    location: appState.location
  };

  updateEnvironmentText(environment, tide);
  renderActiveElements();
  setTextIfChanged($("#homeTimeBand"), environment.timeBand);

  const tideMode = $("#tideStillMode");
  tideMode.classList.toggle("active", tide.tideStill);
  tideMode.textContent = tide.tideStill
    ? `潮止まりモード: ON（${tide.closestEvent.type} / ${tide.tideStillPhase}）`
    : "潮止まりモード: OFF";

  audioEngine.updateEnvironment(environment);
}

window.addEventListener("composition-change", (event) => {
  const composition = event.detail;
  $("#compositionName").textContent = composition.name;
  $("#scaleName").textContent = composition.scaleName;
  $("#rhythmName").textContent = composition.rhythm.name;
});

renderSettings();
bindControls();
resetSettings();
updatePlaybackUi();
updateLocationUi();
updateSimulationState();
updateWeather({ force: true }).then(() => {
  lastEnvTextUpdate = 0;
  tick();
});
setInterval(() => updateWeather(), WEATHER_REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateWeather();
});
setInterval(tick, 3000);
