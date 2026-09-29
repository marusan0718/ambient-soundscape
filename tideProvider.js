const TIDE_LATITUDE = 35.62;
const TIDE_LONGITUDE = 139.77;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class DemoTideProvider {
  constructor() {
    this.enabled = false;
    this.cache = null;
    this.lastFetch = 0;
    this.refresh();
    setInterval(() => this.refresh(), 10 * 60 * 1000);
  }
  setDemoMode(enabled) { this.enabled = enabled; }
  async refresh() {
    try {
      const params = new URLSearchParams({
        latitude: TIDE_LATITUDE, longitude: TIDE_LONGITUDE,
        hourly: "sea_level_height_msl", timezone: "Asia/Tokyo",
        past_days: "1", forecast_days: "2", cell_selection: "sea"
      });
      const response = await fetch("https://marine-api.open-meteo.com/v1/marine?" + params);
      if (!response.ok) throw new Error("Tide request failed");
      const data = await response.json();
      this.cache = data.hourly;
      this.lastFetch = Date.now();
    } catch (e) { console.warn("Tide API fallback", e); }
  }
  getCurrentTide(now = new Date()) {
    if (!this.cache?.time?.length) return this.fallback(now);
    const times=this.cache.time.map(t=>new Date(t).getTime()), values=this.cache.sea_level_height_msl;
    let i=times.findIndex(t=>t>=now.getTime()); if(i<1)i=Math.max(1,times.length-1);
    const frac=clamp((now.getTime()-times[i-1])/(times[i]-times[i-1]),0,1);
    const metres=values[i-1]+(values[i]-values[i-1])*frac;
    const slope=values[i]-values[i-1], direction=slope>=0?"上潮":"下潮";
    const localDate=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo"}).format(now);
    const day=values.filter((_,j)=>this.cache.time[j].startsWith(localDate));
    const lo=Math.min(...day), hi=Math.max(...day), norm=clamp((metres-lo)/Math.max(.01,hi-lo),0,1);
    const speedNorm=clamp(Math.abs(slope)/0.16,0,1);
    const still=speedNorm<.12;
    return {demo:false,tideLevel:Math.round((metres-lo)*100),currentSpeed:Number(Math.abs(slope).toFixed(2)),
      speedNorm,direction,highTideTime:null,lowTideTime:null,minutesToHighTide:0,minutesToLowTide:0,
      tideStill:still,tideStillPhase:still?"center":"none",closestEvent:{type:norm>.5?"満潮":"干潮",minutes:0,signedMinutes:0},
      seaLevelHeight:metres,tideNorm:norm};
  }
  fallback(now) {
    const x=(now.getTime()/1000/60)/(12*60+25)*Math.PI*2, n=(Math.cos(x)+1)/2, rising=Math.sin(x)<0;
    return {demo:true,tideLevel:Math.round(n*124),currentSpeed:.4,speedNorm:.25,direction:rising?"上潮":"下潮",
      highTideTime:null,lowTideTime:null,minutesToHighTide:0,minutesToLowTide:0,tideStill:false,tideStillPhase:"none",
      closestEvent:{type:n>.5?"満潮":"干潮",minutes:0,signedMinutes:0},tideNorm:n};
  }
}
window.DemoTideProvider = DemoTideProvider;