import { useState, useEffect } from "react";

const PLATFORMS = [
  { id: "naver", name: "네이버쇼핑", flag: "🇰🇷", color: "#03C75A", tier: 1 },
  { id: "ali", name: "알리익스프레스", flag: "🇨🇳", color: "#FF6A00", tier: 1 },
  { id: "amazon", name: "아마존", flag: "🇺🇸", color: "#FF9900", tier: 1 },
  { id: "ebay", name: "이베이", flag: "🇺🇸", color: "#0064D2", tier: 1 },
  { id: "temu", name: "테무", flag: "🛒", color: "#FF6B35", tier: 2 },
];

const WEIGHTS = [
  { oz: "1/8", g: 3.5 },
  { oz: "1/4", g: 7.1 },
  { oz: "3/8", g: 10.6 },
  { oz: "1/2", g: 14.2 },
  { oz: "3/4", g: 21.3 },
  { oz: "1", g: 28.4 },
];

const SHEET_ID = "1jWL31J8bqKLE9OC0CW7Q8Ac6HpzpLE2L_q5L5SNGmAA";

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const values = [];
    let cur = "", inQ = false;
    for (let c of line) {
      if (c === '"') inQ = !inQ;
      else if (c === "," && !inQ) { values.push(cur); cur = ""; }
      else cur += c;
    }
    values.push(cur);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || "").trim(); });
    return obj;
  });
}

async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Sheets fetch failed");
  return parseCSV(await res.text());
}

function StatusDot({ active }) {
  return (
    <span style={{
      display: "inline-block", width: 7, height: 7, borderRadius: "50%",
      background: active ? "#4ade80" : "#facc15",
      boxShadow: active ? "0 0 6px #4ade80aa" : "none",
      marginRight: 6,
    }} />
  );
}

function MiniChart({ data }) {
  if (!data || data.length < 2) return (
    <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 11, color: "#3a3d44", fontFamily: "'Noto Sans KR', sans-serif" }}>데이터 누적 중...</span>
    </div>
  );
  const vals = data.map(d => d.avg);
  const max = Math.max(...vals), min = Math.min(...vals);
  const range = max - min || 1;
  const w = 268, h = 60, pad = 8;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const area = `${pad},${h - pad} ${pts} ${w - pad},${h - pad}`;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4a843" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#d4a843" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#cg)" />
      <polyline points={pts} fill="none" stroke="#d4a843" strokeWidth="2" strokeLinejoin="round" />
      {vals.map((v, i) => {
        const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        return <circle key={i} cx={x} cy={y} r="3" fill="#d4a843" />;
      })}
    </svg>
  );
}

export default function App() {
  const [selectedWeight, setSelectedWeight] = useState("1/4");
  const [hoveredPlatform, setHoveredPlatform] = useState(null);
  const [latestData, setLatestData] = useState([]);
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [latest, history] = await Promise.all([
          fetchSheet("최신가격"),
          fetchSheet("히스토리"),
        ]);
        setLatestData(latest);
        setHistoryData(history);
        if (latest.length > 0) setLastUpdate(latest[0]["마지막업데이트"] || "");
      } catch (e) {
        setError("Sheets 데이터 로딩 실패 — 공개 설정을 확인하세요");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const currentRow = latestData.find(r => r["무게(oz)"] === selectedWeight) || {};
  const prices = {
    naver: currentRow["네이버"] ? parseInt(currentRow["네이버"]) : null,
    ali: currentRow["알리"] ? parseInt(currentRow["알리"]) : null,
    amazon: currentRow["아마존"] ? parseInt(currentRow["아마존"]) : null,
    ebay: currentRow["이베이"] ? parseInt(currentRow["이베이"]) : null,
    temu: currentRow["테무"] ? parseInt(currentRow["테무"]) : null,
  };
  const priceValues = Object.values(prices).filter(v => v > 0);
  const avgPrice = priceValues.length ? Math.round(priceValues.reduce((a, b) => a + b, 0) / priceValues.length) : null;
  const minPrice = priceValues.length ? Math.min(...priceValues) : null;
  const minPlatform = PLATFORMS.find(p => prices[p.id] === minPrice);

  const weightHistory = historyData
    .filter(r => r["무게(oz)"] === selectedWeight)
    .slice(-7)
    .map(r => {
      const vals = ["네이버", "알리", "아마존", "이베이", "테무"]
        .map(k => parseFloat(r[k])).filter(v => !isNaN(v) && v > 0);
      return { date: (r["날짜"] || "").slice(5, 10), avg: vals.length ? Math.round(vals.reduce((a, b) => a + b) / vals.length) : 0 };
    }).filter(d => d.avg > 0);

  return (
    <div style={{ minHeight: "100vh", background: "#0d0f12", color: "#e2e0d8", fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #1a1d22; } ::-webkit-scrollbar-thumb { background: #3a3d44; border-radius: 2px; }
        .wbtn { transition: all 0.15s ease; cursor: pointer; border: none; }
        .wbtn:hover { background: #2a2d34 !important; }
        .prow { transition: background 0.15s ease; cursor: default; }
        .prow:hover { background: #1e2128 !important; }
        .wref { transition: all 0.15s ease; cursor: pointer; }
        .wref:hover { background: #1a1d22 !important; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e2228", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0f12", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, background: "#d4a843", clipPath: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)" }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.08em", color: "#e8e4d8" }}>TUNGSTEN TRACKER</div>
            <div style={{ fontSize: 10, color: "#5a5e68", letterSpacing: "0.12em", fontFamily: "'Noto Sans KR', sans-serif" }}>텅스텐 싱커 글로벌 가격비교</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#5a5e68", letterSpacing: "0.1em" }}>LAST UPDATE</div>
            <div style={{ fontSize: 12, color: loading ? "#5a5e68" : "#d4a843" }}>{loading ? "로딩 중..." : lastUpdate || "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {PLATFORMS.map(p => <div key={p.id} title={p.name}><StatusDot active={!!(prices[p.id] > 0)} /></div>)}
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 28px", maxWidth: 960, margin: "0 auto" }}>
        {error && <div style={{ background: "#1a0a0a", border: "1px solid #f87171", borderRadius: 4, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#f87171", fontFamily: "'Noto Sans KR', sans-serif" }}>⚠️ {error}</div>}

        {/* Weight filter */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 10, color: "#5a5e68", letterSpacing: "0.12em", marginBottom: 8 }}>WEIGHT (OZ)</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {WEIGHTS.map(w => (
              <button key={w.oz} className="wbtn" onClick={() => setSelectedWeight(w.oz)} style={{
                padding: "5px 10px", fontSize: 11, borderRadius: 3,
                background: selectedWeight === w.oz ? "#d4a843" : "#1a1d22",
                color: selectedWeight === w.oz ? "#0d0f12" : "#8a8e98",
                fontWeight: selectedWeight === w.oz ? 600 : 400,
                border: `1px solid ${selectedWeight === w.oz ? "#d4a843" : "#2a2d34"}`,
              }}>{w.oz}</button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "전체 평균 가격", value: loading ? "..." : avgPrice ? `₩${avgPrice.toLocaleString()}` : "—", sub: `${selectedWeight}oz · ${WEIGHTS.find(w => w.oz === selectedWeight)?.g}g`, accent: "#d4a843" },
            { label: "최저 플랫폼", value: loading ? "..." : minPlatform?.name || "—", sub: minPrice ? `₩${minPrice.toLocaleString()}` : "데이터 없음", accent: "#4ade80" },
            { label: "수집 플랫폼", value: loading ? "..." : `${priceValues.length} / ${PLATFORMS.length}`, sub: "가격 수집 완료", accent: "#d4a843" },
          ].map((card, i) => (
            <div key={i} style={{ background: "#12151a", border: "1px solid #1e2228", borderTop: `2px solid ${card.accent}`, borderRadius: 4, padding: "16px 18px" }}>
              <div style={{ fontSize: 10, color: "#5a5e68", letterSpacing: "0.12em", marginBottom: 8, fontFamily: "'Noto Sans KR', sans-serif" }}>{card.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: card.accent, marginBottom: 4 }}>{card.value}</div>
              <div style={{ fontSize: 11, color: "#5a5e68", fontFamily: "'Noto Sans KR', sans-serif" }}>{card.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>
          {/* Price table */}
          <div style={{ background: "#12151a", border: "1px solid #1e2228", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid #1e2228", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "#8a8e98" }}>PLATFORM PRICES — {selectedWeight}oz · {WEIGHTS.find(w => w.oz === selectedWeight)?.g}g</div>
              <div style={{ fontSize: 10, color: "#5a5e68", fontFamily: "'Noto Sans KR', sans-serif" }}>배송비 별도</div>
            </div>
            {loading ? (
              <div style={{ padding: "40px 18px", textAlign: "center", color: "#5a5e68", fontSize: 12 }}>데이터 로딩 중...</div>
            ) : PLATFORMS.map(platform => {
              const price = prices[platform.id];
              const hasData = price > 0;
              const pct = (hasData && avgPrice) ? ((price - avgPrice) / avgPrice * 100).toFixed(1) : null;
              const barW = (hasData && priceValues.length) ? Math.round((price / Math.max(...priceValues)) * 100) : 0;
              return (
                <div key={platform.id} className="prow" style={{ padding: "12px 18px", borderBottom: "1px solid #1a1d22", opacity: hasData ? 1 : 0.45, background: hoveredPlatform === platform.id ? "#1e2128" : "transparent" }}
                  onMouseEnter={() => setHoveredPlatform(platform.id)} onMouseLeave={() => setHoveredPlatform(null)}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <StatusDot active={hasData} />
                      <span style={{ fontSize: 10, color: "#5a5e68" }}>{platform.flag}</span>
                      <span style={{ fontSize: 13, fontFamily: "'Noto Sans KR', sans-serif", color: "#c8c4bc" }}>{platform.name}</span>
                      {!hasData && <span style={{ fontSize: 9, color: "#facc15", background: "#2a2500", padding: "1px 6px", borderRadius: 2 }}>수집 중</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {pct && <span style={{ fontSize: 11, color: parseFloat(pct) > 0 ? "#f87171" : "#4ade80" }}>{parseFloat(pct) > 0 ? "+" : ""}{pct}%</span>}
                      <span style={{ fontSize: 16, fontWeight: 600, color: hasData ? platform.color : "#3a3d44", minWidth: 80, textAlign: "right" }}>
                        {hasData ? `₩${price.toLocaleString()}` : "—"}
                      </span>
                    </div>
                  </div>
                  <div style={{ height: 2, background: "#1a1d22", borderRadius: 1 }}>
                    {hasData && <div style={{ height: "100%", width: `${barW}%`, background: platform.color, borderRadius: 1, opacity: 0.7, transition: "width 0.3s ease" }} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#12151a", border: "1px solid #1e2228", borderRadius: 4, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#5a5e68", marginBottom: 12 }}>7-DAY AVG TREND</div>
              <MiniChart data={weightHistory} />
              {weightHistory.length >= 2 && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  {weightHistory.map((d, i) => <div key={i} style={{ fontSize: 9, color: "#3a3d44" }}>{d.date}</div>)}
                </div>
              )}
            </div>
            <div style={{ background: "#12151a", border: "1px solid #1e2228", borderRadius: 4, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#5a5e68", marginBottom: 10 }}>WEIGHT REFERENCE</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {WEIGHTS.map(w => (
                  <div key={w.oz} className="wref" onClick={() => setSelectedWeight(w.oz)} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "4px 8px", borderRadius: 3,
                    background: selectedWeight === w.oz ? "#1e2228" : "transparent",
                    border: `1px solid ${selectedWeight === w.oz ? "#d4a843" : "transparent"}`,
                  }}>
                    <span style={{ fontSize: 12, color: selectedWeight === w.oz ? "#d4a843" : "#6a6e78", fontWeight: selectedWeight === w.oz ? 600 : 400 }}>{w.oz} oz</span>
                    <span style={{ fontSize: 10, color: "#3a3d44" }}>{w.g}g</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
