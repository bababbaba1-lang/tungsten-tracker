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
  const w = 80, h = 28, pad = 3;
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

const RANK_COLORS = ["#d4a843", "#9ca3af", "#b87333"];
const RANK_LABELS = ["1ST", "2ND", "3RD", "4TH", "5TH"];

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
        setError("데이터 로딩 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 선택한 무게의 쇼핑몰 리스트
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

  // 히스토리에서 선택 무게 7일 데이터
  const weightHistory = historyData
    .filter(r => r["무게(oz)"] === selectedWeight && r["1위가격"])
    .slice(-7)
    .map(r => r["1위가격"]);

  const bestPrice = shops[0]?.price || null;
  const bestMall = shops[0]?.mall || null;

  // 가격 변동률 (첫번째 vs 마지막 히스토리)
  const priceTrend = (() => {
    const valid = weightHistory.map(Number).filter(v => !isNaN(v) && v > 0);
    if (valid.length < 2) return null;
    const pct = ((valid[valid.length - 1] - valid[0]) / valid[0] * 100).toFixed(1);
    return parseFloat(pct);
  })();

  return (
    <div style={{ minHeight: "100vh", background: "#0a0c0f", color: "#e2e0d8", fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        .wbtn { transition: all 0.12s ease; cursor: pointer; border: none; outline: none; }
        .wbtn:hover { background: #1e2128 !important; color: #d4a843 !important; }
        .shop-row { transition: background 0.12s ease; }
        .shop-row:hover { background: #131619 !important; }
        .link-btn { transition: all 0.12s ease; cursor: pointer; text-decoration: none; }
        .link-btn:hover { background: #d4a843 !important; color: #0a0c0f !important; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1a1d22", padding: "14px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#0a0c0f", position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 30, height: 30, background: "#d4a843",
            clipPath: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
          }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.1em", color: "#e8e4d8" }}>
              TUNGSTEN TRACKER
            </div>
            <div style={{ fontSize: 9, color: "#4a4e58", letterSpacing: "0.15em", fontFamily: "'Noto Sans KR', sans-serif", marginTop: 1 }}>
              네이버 쇼핑 텅스텐 싱커 최저가
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#4a4e58", letterSpacing: "0.1em", marginBottom: 2 }}>LAST UPDATE</div>
          <div style={{ fontSize: 11, color: loading ? "#4a4e58" : "#d4a843" }}>
            {loading ? "로딩 중..." : lastUpdate || "—"}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "28px 24px" }}>

        {error && (
          <div style={{ background: "#1a0808", border: "1px solid #f87171", borderRadius: 4, padding: "10px 14px", marginBottom: 20, fontSize: 11, color: "#f87171", fontFamily: "'Noto Sans KR', sans-serif" }}>
            ⚠️ {error}
          </div>
        )}

        {/* Weight selector */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 9, color: "#4a4e58", letterSpacing: "0.15em", marginBottom: 10 }}>WEIGHT</div>
          <div style={{ display: "flex", gap: 3 }}>
            {WEIGHTS.map(w => (
              <button key={w.oz} className="wbtn" onClick={() => setSelectedWeight(w.oz)} style={{
                flex: 1, padding: "10px 4px", fontSize: 12, borderRadius: 3,
                background: selectedWeight === w.oz ? "#d4a843" : "#111417",
                color: selectedWeight === w.oz ? "#0a0c0f" : "#5a5e68",
                fontWeight: selectedWeight === w.oz ? 700 : 400,
                border: `1px solid ${selectedWeight === w.oz ? "#d4a843" : "#1e2128"}`,
                fontFamily: "'IBM Plex Mono', monospace",
              }}>
                <div>{w.oz}</div>
                <div style={{ fontSize: 9, marginTop: 2, opacity: 0.7 }}>{w.g}g</div>
              </button>
            ))}
          </div>
        </div>

        {/* Summary bar */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8, marginBottom: 24,
        }}>
          {[
            {
              label: "네이버 최저가",
              value: loading ? "..." : bestPrice ? `₩${bestPrice.toLocaleString()}` : "—",
              sub: bestMall || `${selectedWeight}oz · ${WEIGHTS.find(w => w.oz === selectedWeight)?.g}g`,
              accent: "#d4a843",
            },
            {
              label: "최저가 쇼핑몰",
              value: loading ? "..." : bestMall || "—",
              sub: shops.length > 0 ? `${shops.length}개 쇼핑몰 비교` : "데이터 없음",
              accent: "#4ade80",
            },
            {
              label: "7일 가격 추이",
              value: priceTrend !== null
                ? `${priceTrend > 0 ? "+" : ""}${priceTrend}%`
                : "—",
              sub: priceTrend !== null
                ? priceTrend > 0 ? "가격 상승" : priceTrend < 0 ? "가격 하락" : "변동 없음"
                : "데이터 수집 중",
              accent: priceTrend > 0 ? "#f87171" : priceTrend < 0 ? "#4ade80" : "#d4a843",
              sparkline: weightHistory,
            },
          ].map((card, i) => (
            <div key={i} style={{
              background: "#0e1114", border: "1px solid #1a1d22",
              borderTop: `2px solid ${card.accent}`, borderRadius: 4,
              padding: "14px 16px",
            }}>
              <div style={{ fontSize: 9, color: "#4a4e58", letterSpacing: "0.12em", marginBottom: 8, fontFamily: "'Noto Sans KR', sans-serif" }}>
                {card.label}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: card.accent, marginBottom: 3 }}>
                    {card.value}
                  </div>
                  <div style={{ fontSize: 10, color: "#4a4e58", fontFamily: "'Noto Sans KR', sans-serif" }}>
                    {card.sub}
                  </div>
                </div>
                {card.sparkline && <MiniSparkline data={card.sparkline} />}
              </div>
            </div>
          ))}
        </div>

        {/* Shop ranking table */}
        <div style={{ background: "#0e1114", border: "1px solid #1a1d22", borderRadius: 4, overflow: "hidden" }}>

          {/* Table header */}
          <div style={{
            padding: "12px 20px", borderBottom: "1px solid #1a1d22",
            display: "grid", gridTemplateColumns: "40px 1fr 120px 100px",
            gap: 12, alignItems: "center",
          }}>
            <div style={{ fontSize: 9, color: "#4a4e58", letterSpacing: "0.12em" }}>순위</div>
            <div style={{ fontSize: 9, color: "#4a4e58", letterSpacing: "0.12em" }}>쇼핑몰 / 상품명</div>
            <div style={{ fontSize: 9, color: "#4a4e58", letterSpacing: "0.12em", textAlign: "right" }}>가격</div>
            <div style={{ fontSize: 9, color: "#4a4e58", letterSpacing: "0.12em", textAlign: "center" }}>링크</div>
          </div>

          {loading ? (
            <div style={{ padding: "48px 20px", textAlign: "center", color: "#4a4e58", fontSize: 12, fontFamily: "'Noto Sans KR', sans-serif" }}>
              데이터 로딩 중...
            </div>
          ) : shops.length === 0 ? (
            <div style={{ padding: "48px 20px", textAlign: "center", color: "#4a4e58", fontSize: 12, fontFamily: "'Noto Sans KR', sans-serif" }}>
              {selectedWeight}oz 데이터 없음 — 다음 수집 시 업데이트됩니다
            </div>
          ) : (
            shops.map((shop, i) => {
              const isTop3 = i < 3;
              const rankColor = RANK_COLORS[i] || "#3a3d44";
              const pctVsBest = i > 0 && bestPrice
                ? (((shop.price - bestPrice) / bestPrice) * 100).toFixed(1)
                : null;

              return (
                <div key={i} className="shop-row" style={{
                  padding: "14px 20px", borderBottom: "1px solid #111417",
                  display: "grid", gridTemplateColumns: "40px 1fr 120px 100px",
                  gap: 12, alignItems: "center",
                  background: i === 0 ? "#0f1218" : "transparent",
                }}>
                  {/* 순위 */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <div style={{
                      fontSize: 9, fontWeight: 700, color: isTop3 ? rankColor : "#3a3d44",
                      letterSpacing: "0.08em",
                    }}>
                      {RANK_LABELS[i]}
                    </div>
                    {i === 0 && (
                      <div style={{ fontSize: 8, color: "#d4a843", background: "#1e1800", padding: "1px 4px", borderRadius: 2 }}>
                        최저
                      </div>
                    )}
                  </div>

                  {/* 쇼핑몰 + 상품명 */}
                  <div>
                    <div style={{
                      fontSize: 13, fontWeight: 600,
                      color: isTop3 ? rankColor : "#6a6e78",
                      fontFamily: "'Noto Sans KR', sans-serif",
                      marginBottom: 3,
                    }}>
                      {shop.mall}
                    </div>
                    <div style={{
                      fontSize: 10, color: "#3a3d44",
                      fontFamily: "'Noto Sans KR', sans-serif",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      maxWidth: 320,
                    }}>
                      {shop.title}
                    </div>
                  </div>

                  {/* 가격 */}
                  <div style={{ textAlign: "right" }}>
                    <div style={{
                      fontSize: 16, fontWeight: 700,
                      color: i === 0 ? "#d4a843" : "#8a8e98",
                    }}>
                      ₩{shop.price.toLocaleString()}
                    </div>
                    {pctVsBest && (
                      <div style={{ fontSize: 10, color: "#f87171", marginTop: 2 }}>
                        +{pctVsBest}%
                      </div>
                    )}
                  </div>

                  {/* 링크 */}
                  <div style={{ textAlign: "center" }}>
                    {shop.link ? (
                      <a
                        href={shop.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link-btn"
                        style={{
                          display: "inline-block",
                          padding: "5px 12px",
                          fontSize: 10,
                          background: i === 0 ? "#1e1800" : "#111417",
                          color: i === 0 ? "#d4a843" : "#5a5e68",
                          border: `1px solid ${i === 0 ? "#d4a843" : "#2a2d34"}`,
                          borderRadius: 3,
                          letterSpacing: "0.06em",
                          fontFamily: "'IBM Plex Mono', monospace",
                        }}
                      >
                        보러가기
                      </a>
                    ) : (
                      <span style={{ fontSize: 10, color: "#2a2d34" }}>—</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 9, color: "#2a2d34", letterSpacing: "0.1em" }}>
            NAVER SHOPPING API · 매일 06:00 / 18:00 업데이트
          </div>
          <div style={{ fontSize: 9, color: "#2a2d34", letterSpacing: "0.1em" }}>
            가격은 배송비 별도 기준
          </div>
        </div>
      </div>
    </div>
  );
}
