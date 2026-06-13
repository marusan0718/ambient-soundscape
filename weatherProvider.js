const WEATHER_LABELS = {
  0: "晴れ",
  1: "晴れ",
  2: "曇り",
  3: "曇り",
  45: "曇り",
  48: "曇り",
  51: "雨",
  53: "雨",
  55: "雨",
  61: "雨",
  63: "雨",
  65: "雨",
  80: "雨",
  81: "雨",
  82: "雨"
};

async function fetchWeather({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
    timezone: "auto"
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Weather request failed");
  }

  const data = await response.json();
  const current = data.current || {};
  const code = current.weather_code ?? 0;

  return {
    weather: WEATHER_LABELS[code] || "曇り",
    weatherCode: code,
    temperature: Math.round(current.temperature_2m ?? 22),
    humidity: Math.round(current.relative_humidity_2m ?? 62),
    windSpeed: Number(current.wind_speed_10m ?? 2),
    source: "Open-Meteo"
  };
}

function fallbackWeather(now = new Date()) {
  const hour = now.getHours();
  const weather = hour >= 6 && hour < 15 ? "晴れ" : hour >= 15 && hour < 22 ? "曇り" : "雨";

  return {
    weather,
    weatherCode: weather === "晴れ" ? 1 : weather === "雨" ? 61 : 3,
    temperature: weather === "晴れ" ? 24 : 21,
    humidity: weather === "雨" ? 82 : 64,
    windSpeed: weather === "曇り" ? 4.4 : 2.1,
    source: "Demo"
  };
}

window.fetchWeather = fetchWeather;
window.fallbackWeather = fallbackWeather;
