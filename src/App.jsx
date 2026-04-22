import { useState, useEffect } from "react";

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
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
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

async function fetchSheet(name) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed");
  return parseCSV(await res.text());
}

function MiniSparkline({ data }) {
  if (!data || data.length < 2) return null;
  const vals = data.map(Number).filter(v => !isNaN(v) && v > 0);
  if (vals.length < 2) return null;
  const max = Math.max(...vals), min = Math.min(...vals);
  const range = max - min || 1;
  const w = 72, h = 26, pad = 3;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const trend = vals[vals.length - 1] - vals[0];
  const color = trend > 0 ? "#f87171" : trend < 0 ? "#4ade80" : "#d4a843";
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {vals.map((v, i) => {
        const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        return i === vals.length - 1 ? <circle key={i} cx={x} cy={y} r="2.5" fill={color} /> : null;
      })}
    </svg>
  );
}

const RANK_MEDALS = ["🥇", "🥈", "🥉", "4위", "5위"];
const RANK_COLORS = ["#d4a843", "#b0b8c8", "#cd7f32", "#6a7080", "#6a7080"];

export default function App() {
  const [selectedWeight, setSelectedWeight] = useState("1/4");
  const [allData, setAllData] = useState([]);
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [latest, history] = await Promise.all([
          fetchSheet("최신가격"),
          fetchSheet("히스토리"),
        ]);
        setAllData(latest);
        setHistoryData(history);
        const row = latest.find(r => r["업데이트"]);
        if (row) setLastUpdate(row["업데이트"]);
      } catch (e) {
        setError("데이터 로딩 실패 — Sheets 공개 설정을 확인하세요");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const shops = allData
    .filter(r => r["무게(oz)"] === selectedWeight && r["쇼핑몰"] !== "없음" && r["가격"])
    .map(r => ({
      rank: parseInt(r["순위"]) || 0,
      mall: r["쇼핑몰"],
      price: parseInt(r["가격"]) || 0,
      title: r["상품명"],
      link: r["링크"],
    }))
    .sort((a, b) => a.rank - b.rank);

  const weightHistory = historyData
    .filter(r => r["무게(oz)"] === selectedWeight && r["1위가격"])
    .slice(-7)
    .map(r => r["1위가격"]);

  const bestPrice = shops[0]?.price || null;
  const bestMall = shops[0]?.mall || null;

  const priceTrend = (() => {
    const valid = weightHistory.map(Number).filter(v => !isNaN(v) && v > 0);
    if (valid.length < 2) return null;
    return parseFloat(((valid[valid.length - 1] - valid[0]) / valid[0] * 100).toFixed(1));
  })();

  return (
    <div style={{ minHeight: "100vh", background: "#0d0f13", color: "#dfe1e8", fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #181b22; } ::-webkit-scrollbar-thumb { background: #2e3340; border-radius: 2px; }
        .wbtn { cursor: pointer; border: none; outline: none; transition: all 0.13s; }
        .wbtn:hover { transform: translateY(-1px); }
        .shop-row { transition: background 0.12s; }
        .shop-row:hover { background: #161921 !important; }
        .link-btn { text-decoration: none; transition: all 0.13s; display: inline-block; }
        .link-btn:hover { background: #d4a843 !important; color: #0d0f13 !important; transform: translateY(-1px); }
      `}</style>

      {/* Header */}
      <div style={{
        background: "#0d0f13",
        borderBottom: "1px solid #1f2330",
        padding: "16px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 34, height: 34, background: "#d4a843",
            clipPath: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
            flexShrink: 0,
          }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.1em", color: "#f0ede4" }}>
              TUNGSTEN TRACKER
            </div>
            <div style={{ fontSize: 10, color: "#5c6070", letterSpacing: "0.12em", fontFamily: "'Noto Sans KR', sans-serif", marginTop: 1 }}>
              네이버 쇼핑 텅스텐 싱커 최저가 비교
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#5c6070", letterSpacing: "0.12em", marginBottom: 3 }}>LAST UPDATE</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: loading ? "#5c6070" : "#d4a843" }}>
            {loading ? "로딩 중..." : lastUpdate || "—"}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px" }}>

        {error && (
          <div style={{ background: "#1c0a0a", border: "1px solid #f87171", borderRadius: 6, padding: "12px 16px", marginBottom: 24, fontSize: 12, color: "#f87171", fontFamily: "'Noto Sans KR', sans-serif" }}>
            ⚠️ {error}
          </div>
        )}

        {/* Weight selector */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 10, color: "#5c6070", letterSpacing: "0.18em", marginBottom: 12 }}>
            — WEIGHT SELECTION —
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {WEIGHTS.map(w => {
              const active = selectedWeight === w.oz;
              return (
                <button key={w.oz} className="wbtn" onClick={() => setSelectedWeight(w.oz)} style={{
                  flex: 1, padding: "12px 6px", borderRadius: 6,
                  background: active ? "#d4a843" : "#13161e",
                  border: `1px solid ${active ? "#d4a843" : "#252836"}`,
                  fontFamily: "'IBM Plex Mono', monospace",
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: active ? "#0d0f13" : "#9aa0b0" }}>
                    {w.oz}
                  </div>
                  <div style={{ fontSize: 10, color: active ? "#0d0f13" : "#5c6070", marginTop: 3 }}>
                    {w.g}g
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 28 }}>
          {[
            {
              label: "네이버 최저가",
              value: loading ? "..." : bestPrice ? `₩${bestPrice.toLocaleString()}` : "—",
              sub: bestMall || `${selectedWeight}oz · ${WEIGHTS.find(w => w.oz === selectedWeight)?.g}g`,
              accent: "#d4a843",
              icon: "💰",
            },
            {
              label: "최저가 쇼핑몰",
              value: loading ? "..." : bestMall || "—",
              sub: shops.length > 0 ? `${shops.length}개 쇼핑몰 비교` : "수집 중",
              accent: "#4ade80",
              icon: "🏪",
            },
            {
              label: "7일 가격 추이",
              value: priceTrend !== null ? `${priceTrend > 0 ? "▲" : priceTrend < 0 ? "▼" : "─"} ${Math.abs(priceTrend)}%` : "—",
              sub: priceTrend !== null ? (priceTrend > 0 ? "가격 상승 중" : priceTrend < 0 ? "가격 하락 중" : "변동 없음") : "데이터 수집 중",
              accent: priceTrend > 0 ? "#f87171" : priceTrend < 0 ? "#4ade80" : "#d4a843",
              icon: "📈",
              sparkline: weightHistory,
            },
          ].map((card, i) => (
            <div key={i} style={{
              background: "#111420",
              border: "1px solid #1f2330",
              borderTop: `3px solid ${card.accent}`,
              borderRadius: 6,
              padding: "16px 18px",
            }}>
              <div style={{ fontSize: 10, color: "#5c6070", letterSpacing: "0.1em", marginBottom: 10, fontFamily: "'Noto Sans KR', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                <span>{card.icon}</span> {card.label}
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: card.accent, marginBottom: 5, letterSpacing: "-0.01em" }}>
                    {card.value}
                  </div>
                  <div style={{ fontSize: 11, color: "#7a8090", fontFamily: "'Noto Sans KR', sans-serif" }}>
                    {card.sub}
                  </div>
                </div>
                {card.sparkline && <MiniSparkline data={card.sparkline} />}
              </div>
            </div>
          ))}
        </div>

        {/* Shop table */}
        <div style={{ background: "#111420", border: "1px solid #1f2330", borderRadius: 8, overflow: "hidden" }}>

          {/* Table title */}
          <div style={{
            padding: "14px 22px",
            borderBottom: "1px solid #1f2330",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "#0f1119",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 3, height: 16, background: "#d4a843", borderRadius: 2 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#c8cad4", letterSpacing: "0.08em" }}>
                {selectedWeight}oz ({WEIGHTS.find(w => w.oz === selectedWeight)?.g}g) 쇼핑몰 순위
              </span>
            </div>
            <span style={{ fontSize: 10, color: "#5c6070", fontFamily: "'Noto Sans KR', sans-serif" }}>
              배송비 별도 기준
            </span>
          </div>

          {/* Column headers */}
          <div style={{
            padding: "10px 22px",
            display: "grid", gridTemplateColumns: "56px 1fr 140px 110px",
            gap: 12, alignItems: "center",
            borderBottom: "1px solid #181b24",
            background: "#0d1016",
          }}>
            {["순위", "쇼핑몰 / 상품명", "가격", "바로가기"].map((h, i) => (
              <div key={i} style={{
                fontSize: 9, color: "#5c6070", letterSpacing: "0.14em",
                textAlign: i >= 2 ? "right" : i === 3 ? "center" : "left",
              }}>
                {h}
              </div>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: "56px 22px", textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
              <div style={{ fontSize: 13, color: "#5c6070", fontFamily: "'Noto Sans KR', sans-serif" }}>
                데이터 로딩 중...
              </div>
            </div>
          ) : shops.length === 0 ? (
            <div style={{ padding: "56px 22px", textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>🎣</div>
              <div style={{ fontSize: 13, color: "#5c6070", fontFamily: "'Noto Sans KR', sans-serif" }}>
                {selectedWeight}oz 데이터 없음 — 다음 수집 시 업데이트됩니다
              </div>
            </div>
          ) : (
            shops.map((shop, i) => {
              const isFirst = i === 0;
              const rankColor = RANK_COLORS[i] || "#5c6070";
              const pctVsBest = i > 0 && bestPrice
                ? (((shop.price - bestPrice) / bestPrice) * 100).toFixed(1)
                : null;

              return (
                <div key={i} className="shop-row" style={{
                  padding: "16px 22px",
                  display: "grid", gridTemplateColumns: "56px 1fr 140px 110px",
                  gap: 12, alignItems: "center",
                  borderBottom: i < shops.length - 1 ? "1px solid #181b24" : "none",
                  background: isFirst ? "#131825" : "transparent",
                }}>

                  {/* 순위 */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                    <div style={{ fontSize: i < 3 ? 20 : 13, lineHeight: 1 }}>
                      {i < 3 ? RANK_MEDALS[i] : RANK_MEDALS[i]}
                    </div>
                    {isFirst && (
                      <div style={{
                        fontSize: 8, fontWeight: 700, color: "#0d0f13",
                        background: "#d4a843", padding: "2px 5px", borderRadius: 2,
                        letterSpacing: "0.06em",
                      }}>
                        최저
                      </div>
                    )}
                  </div>

                  {/* 쇼핑몰 + 상품명 */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 15, fontWeight: 700,
                      color: isFirst ? "#f0ede4" : i < 3 ? "#c8cad4" : "#8a8e98",
                      fontFamily: "'Noto Sans KR', sans-serif",
                      marginBottom: 5,
                    }}>
                      {shop.mall}
                    </div>
                    <div style={{
                      fontSize: 11, color: "#5c6070",
                      fontFamily: "'Noto Sans KR', sans-serif",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {shop.title}
                    </div>
                  </div>

                  {/* 가격 */}
                  <div style={{ textAlign: "right" }}>
                    <div style={{
                      fontSize: isFirst ? 20 : 17,
                      fontWeight: 700,
                      color: isFirst ? "#d4a843" : i < 3 ? "#c8cad4" : "#7a8090",
                      letterSpacing: "-0.01em",
                    }}>
                      ₩{shop.price.toLocaleString()}
                    </div>
                    {pctVsBest && (
                      <div style={{ fontSize: 11, color: "#f87171", marginTop: 3, fontWeight: 600 }}>
                        +{pctVsBest}%
                      </div>
                    )}
                  </div>

                  {/* 링크 */}
                  <div style={{ textAlign: "right" }}>
                    {shop.link ? (
                      <a
                        href={shop.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link-btn"
                        style={{
                          padding: "7px 14px",
                          fontSize: 11, fontWeight: 600,
                          background: isFirst ? "#d4a843" : "#1c2030",
                          color: isFirst ? "#0d0f13" : "#9aa0b0",
                          border: `1px solid ${isFirst ? "#d4a843" : "#2e3340"}`,
                          borderRadius: 5,
                          fontFamily: "'Noto Sans KR', sans-serif",
                          letterSpacing: "0.04em",
                        }}
                      >
                        보러가기 →
                      </a>
                    ) : (
                      <span style={{ fontSize: 11, color: "#2e3340" }}>—</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 20, padding: "0 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 9, color: "#2e3340", letterSpacing: "0.1em" }}>
            NAVER SHOPPING API · 매일 06:00 / 18:00 업데이트
          </div>
          <div style={{ fontSize: 9, color: "#2e3340", letterSpacing: "0.1em" }}>
            가격은 배송비 별도 기준
          </div>
        </div>
      </div>
    </div>
  );
}
