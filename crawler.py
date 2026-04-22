"""
텅스텐 싱커 가격 크롤러 v4
- 네이버 쇼핑 API 중심
- 상품명에서 무게 파싱 → 무게별 최저가 자동 분류
- 실시간 환율 적용
"""

import os
import re
import time
import requests
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from datetime import datetime

# ─── 설정 ─────────────────────────────────────────────
SPREADSHEET_ID = "1jWL31J8bqKLE9OC0CW7Q8Ac6HpzpLE2L_q5L5SNGmAA"
NAVER_CLIENT_ID = os.environ.get("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET")

# 수집 대상 무게
WEIGHTS = ["1/8", "1/4", "3/8", "1/2", "3/4", "1"]
OZ_TO_G = {
    "1/8": 3.5, "1/4": 7.1, "3/8": 10.6,
    "1/2": 14.2, "3/4": 21.3, "1": 28.4
}
# g → oz 역변환 (파싱용, 허용 오차 ±1g)
G_TO_OZ = {v: k for k, v in OZ_TO_G.items()}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
}

# ─── 실시간 환율 ──────────────────────────────────────
def get_usd_to_krw():
    try:
        res = requests.get("https://open.er-api.com/v6/latest/USD", timeout=5)
        rate = res.json()["rates"]["KRW"]
        print(f"💱 환율: 1 USD = {rate:,.0f} KRW")
        return rate
    except:
        print("⚠️ 환율 API 실패, 기본값 1380 사용")
        return 1380

# ─── 상품명에서 무게(oz) 파싱 ─────────────────────────
def parse_weight_from_title(title):
    """
    상품명에서 무게를 파싱해서 oz 단위로 반환
    예: "텅스텐 싱커 7g" → "1/4"
        "텅스텐 싱커 1/4oz" → "1/4"
        "텅스텐 싱커 3/8온스" → "3/8"
    """
    title = title.lower()

    # oz 직접 표기 패턴
    oz_patterns = [
        r'(\d+/\d+)\s*oz',
        r'(\d+/\d+)\s*온스',
        r'(\d+/\d+)\s*ounce',
    ]
    for pattern in oz_patterns:
        m = re.search(pattern, title)
        if m:
            oz = m.group(1)
            if oz in WEIGHTS:
                return oz

    # g 표기 패턴 → oz 변환
    g_patterns = [
        r'(\d+\.?\d*)\s*g[^a-z]',
        r'(\d+\.?\d*)\s*그램',
        r'(\d+\.?\d*)g\b',
    ]
    for pattern in g_patterns:
        m = re.search(pattern, title)
        if m:
            g_val = float(m.group(1))
            # 허용 오차 ±1.5g 내에서 매칭
            for oz, g in OZ_TO_G.items():
                if abs(g_val - g) <= 1.5:
                    return oz
    return None

# ─── 네이버 쇼핑 크롤러 ───────────────────────────────
def crawl_naver_all():
    """
    네이버 쇼핑에서 텅스텐 싱커 전체 검색 후
    상품명에서 무게 파싱해서 무게별 최저가 반환
    """
    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    }

    # 무게별 가격 수집 딕셔너리
    weight_prices = {oz: [] for oz in WEIGHTS}

    # 여러 쿼리로 최대한 많은 상품 수집
    queries = [
        "텅스텐 싱커",
        "tungsten sinker",
        "텅스텐 낚시 봉돌",
        "텅스텐 싱커 oz",
    ]

    for query in queries:
        for start in [1, 11, 21, 31, 41]:  # 최대 50개 수집
            try:
                params = {
                    "query": query,
                    "display": 10,
                    "start": start,
                    "sort": "sim",  # 정확도순
                }
                res = requests.get(url, headers=headers, params=params, timeout=10)
                data = res.json()
                items = data.get("items", [])

                if not items:
                    break

                for item in items:
                    title = re.sub(r"<[^>]+>", "", item.get("title", ""))
                    price_str = item.get("lprice", "0")

                    # 텅스텐 싱커 관련 상품인지 확인
                    title_lower = title.lower()
                    if not any(k in title_lower for k in ["텅스텐", "tungsten"]):
                        continue
                    if not any(k in title_lower for k in ["싱커", "sinker", "봉돌"]):
                        continue

                    # 가격 파싱
                    try:
                        price = int(price_str)
                    except:
                        continue

                    if price <= 0:
                        continue

                    # 상품명에서 무게 파싱
                    oz = parse_weight_from_title(title)
                    if oz:
                        weight_prices[oz].append({
                            "price": price,
                            "title": title,
                        })
                        print(f"  ✓ [{oz}oz] {price:,}원 — {title[:40]}")

                time.sleep(0.3)

            except Exception as e:
                print(f"  네이버 요청 실패 (query={query}, start={start}): {e}")
                break

        time.sleep(0.5)

    # 무게별 최저가 추출
    results = {}
    print("\n📊 무게별 최저가 집계:")
    for oz in WEIGHTS:
        prices_list = weight_prices[oz]
        if prices_list:
            # 가격 기준 정렬 후 최저가
            prices_list.sort(key=lambda x: x["price"])

            # 이상치 제거: 중앙값의 50% 미만은 노이즈
            price_vals = [p["price"] for p in prices_list]
            median = sorted(price_vals)[len(price_vals) // 2]
            filtered = [p for p in prices_list if p["price"] >= median * 0.3]

            if filtered:
                best = filtered[0]
                results[oz] = best["price"]
                print(f"  {oz}oz ({OZ_TO_G[oz]}g): {best['price']:,}원 ({len(prices_list)}개 상품 중 최저)")
            else:
                results[oz] = None
                print(f"  {oz}oz: 유효 데이터 없음")
        else:
            results[oz] = None
            print(f"  {oz}oz: 검색 결과 없음")

    return results

# ─── 알리 크롤러 (보조) ────────────────────────────────
def crawl_ali_all(usd_rate):
    """알리에서 텅스텐 싱커 검색 후 무게별 최저가"""
    weight_prices = {oz: [] for oz in WEIGHTS}

    try:
        url = "https://www.aliexpress.com/wholesale"
        params = {"SearchText": "tungsten fishing sinker", "SortType": "price_asc"}
        res = requests.get(url, params=params, headers=HEADERS, timeout=15)

        # 가격+상품명 패턴 함께 추출 시도
        # 알리는 JSON 데이터가 포함된 경우가 많음
        items_data = re.findall(
            r'"title":"([^"]*tungsten[^"]*sinker[^"]*)"[^}]*"salePrice":\{"currency":"USD","value":"([\d.]+)"',
            res.text, re.IGNORECASE
        )

        for title, price_usd in items_data:
            oz = parse_weight_from_title(title)
            if oz:
                krw = int(float(price_usd) * usd_rate)
                if krw > 50:  # 최소 50원 이상
                    weight_prices[oz].append(krw)

        # 상품명 없이 가격만 있는 경우 전체 최저가
        if not any(weight_prices.values()):
            prices = re.findall(r'"salePrice":\{"currency":"USD","value":"([\d.]+)"', res.text)
            if prices:
                min_usd = float(min(prices, key=float))
                min_krw = int(min_usd * usd_rate)
                print(f"  알리 전체 최저가: ${min_usd} = {min_krw:,}원 (무게 미분류)")

    except Exception as e:
        print(f"  알리 실패: {e}")

    results = {}
    for oz in WEIGHTS:
        if weight_prices[oz]:
            results[oz] = min(weight_prices[oz])
        else:
            results[oz] = None

    return results

# ─── Google Sheets 연결 ───────────────────────────────
def connect_sheets():
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive"
    ]
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write(creds_json)
            creds_file = f.name
        creds = ServiceAccountCredentials.from_json_keyfile_name(creds_file, scope)
    else:
        creds = ServiceAccountCredentials.from_json_keyfile_name("credentials.json", scope)
    client = gspread.authorize(creds)
    return client.open_by_key(SPREADSHEET_ID)

# ─── Sheets 저장 ──────────────────────────────────────
def save_to_sheets(book, naver_results, ali_results, usd_rate):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    # 최신가격 시트
    try:
        sheet_latest = book.worksheet("최신가격")
    except:
        sheet_latest = book.add_worksheet("최신가격", rows=100, cols=20)

    sheet_latest.clear()
    sheet_latest.append_row([
        "무게(oz)", "무게(g)", "네이버", "알리",
        "환율(USD/KRW)", "마지막업데이트"
    ])

    for oz in WEIGHTS:
        row = [
            oz,
            OZ_TO_G.get(oz, ""),
            naver_results.get(oz) or "",
            ali_results.get(oz) or "",
            int(usd_rate),
            now,
        ]
        sheet_latest.append_row(row)
        time.sleep(0.3)

    # 히스토리 시트
    try:
        sheet_history = book.worksheet("히스토리")
    except:
        sheet_history = book.add_worksheet("히스토리", rows=10000, cols=20)
        sheet_history.append_row(["날짜", "무게(oz)", "네이버", "알리", "환율"])

    for oz in WEIGHTS:
        row = [
            now, oz,
            naver_results.get(oz) or "",
            ali_results.get(oz) or "",
            int(usd_rate),
        ]
        sheet_history.append_row(row)
        time.sleep(0.3)

    print(f"\n✅ Sheets 저장 완료: {now}")

# ─── 메인 ─────────────────────────────────────────────
def main():
    print("🎣 텅스텐 싱커 가격 수집 시작 (v4)...\n")

    usd_rate = get_usd_to_krw()

    print("\n[네이버 수집 중...]")
    naver_results = crawl_naver_all()

    print("\n[알리 수집 중...]")
    ali_results = crawl_ali_all(usd_rate)

    book = connect_sheets()
    save_to_sheets(book, naver_results, ali_results, usd_rate)

    print("\n📦 최종 결과:")
    for oz in WEIGHTS:
        n = naver_results.get(oz)
        a = ali_results.get(oz)
        print(f"  {oz}oz ({OZ_TO_G[oz]}g) — 네이버: {f'{n:,}원' if n else '없음'} / 알리: {f'{a:,}원' if a else '없음'}")

    print("\n🏁 완료!")

if __name__ == "__main__":
    main()
