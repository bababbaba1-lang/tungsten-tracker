"""
텅스텐 싱커 가격 크롤러 v3
- 실시간 환율 적용
- 가격 검증 로직 추가 (무게별 최소/최대 가격 필터)
- 네이버, 알리, 아마존, 이베이 수집
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

WEIGHTS = ["1/8", "1/4", "3/8", "1/2", "3/4", "1"]
OZ_TO_G = {
    "1/8": 3.5, "1/4": 7.1, "3/8": 10.6,
    "1/2": 14.2, "3/4": 21.3, "1": 28.4
}

# 무게별 합리적인 가격 범위 (KRW 기준, 단품 1개)
# 너무 싸거나 너무 비싼 건 노이즈로 제거
PRICE_RANGE_KRW = {
    "1/8": (200, 5000),
    "1/4": (300, 8000),
    "3/8": (500, 10000),
    "1/2": (700, 15000),
    "3/4": (1000, 20000),
    "1":   (1500, 30000),
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
}

# ─── 실시간 환율 가져오기 ─────────────────────────────
def get_usd_to_krw():
    """무료 환율 API에서 USD→KRW 환율 가져오기"""
    try:
        res = requests.get("https://open.er-api.com/v6/latest/USD", timeout=5)
        data = res.json()
        rate = data["rates"]["KRW"]
        print(f"💱 실시간 환율: 1 USD = {rate:,.0f} KRW")
        return rate
    except:
        print("⚠️ 환율 API 실패, 기본값 1380 사용")
        return 1380

# ─── 가격 검증 ─────────────────────────────────────────
def validate_price(price_krw, weight_oz):
    """무게별 합리적인 가격 범위인지 검증"""
    if not price_krw or price_krw <= 0:
        return None
    min_p, max_p = PRICE_RANGE_KRW.get(weight_oz, (100, 50000))
    if min_p <= price_krw <= max_p:
        return price_krw
    return None

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

# ─── 네이버쇼핑 ────────────────────────────────────────
def crawl_naver(weight_oz, usd_rate):
    g = OZ_TO_G[weight_oz]
    # 검색어에 무게를 명확히 포함
    queries = [
        f"텅스텐 싱커 {g}g 낱개",
        f"텅스텐 싱커 {weight_oz}oz",
        f"tungsten sinker {g}g",
    ]
    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    }

    for query in queries:
        try:
            params = {"query": query, "display": 10, "sort": "asc"}
            res = requests.get(url, headers=headers, params=params, timeout=10)
            data = res.json()
            items = data.get("items", [])

            prices = []
            for item in items:
                title = re.sub(r"<[^>]+>", "", item.get("title", "")).lower()
                price_str = re.sub(r"<[^>]+>", "", str(item.get("lprice", 0)))
                # 상품명에 텅스텐/싱커 포함된 것만
                if not any(k in title for k in ["텅스텐", "tungsten", "싱커", "sinker"]):
                    continue
                try:
                    p = int(price_str)
                    valid = validate_price(p, weight_oz)
                    if valid:
                        prices.append(valid)
                except:
                    pass

            if prices:
                return min(prices)
        except Exception as e:
            print(f"    네이버 쿼리 실패 ({query}): {e}")
        time.sleep(0.5)

    return None

# ─── 알리익스프레스 ────────────────────────────────────
def crawl_ali(weight_oz, usd_rate):
    g = OZ_TO_G[weight_oz]
    queries = [
        f"tungsten fishing sinker {g}g",
        f"tungsten sinker {weight_oz}oz fishing",
    ]

    for query in queries:
        try:
            url = "https://www.aliexpress.com/wholesale"
            params = {"SearchText": query, "SortType": "price_asc"}
            res = requests.get(url, params=params, headers=HEADERS, timeout=15)

            # 여러 패턴 시도
            prices_usd = []
            patterns = [
                r'"salePrice":\{"currency":"USD","value":"([\d.]+)"',
                r'"minPrice":([\d.]+)',
                r'US \$([\d.]+)',
            ]
            for pattern in patterns:
                found = re.findall(pattern, res.text)
                prices_usd.extend([float(p) for p in found if float(p) > 0.1])

            if prices_usd:
                usd = min(prices_usd)
                krw = int(usd * usd_rate)
                valid = validate_price(krw, weight_oz)
                if valid:
                    return valid
        except Exception as e:
            print(f"    알리 쿼리 실패: {e}")
        time.sleep(1)

    return None

# ─── 아마존 ───────────────────────────────────────────
def crawl_amazon(weight_oz, usd_rate):
    g = OZ_TO_G[weight_oz]
    query = f"tungsten+fishing+sinker+{weight_oz.replace('/', '%2F')}oz+{g}g"
    url = f"https://www.amazon.com/s?k={query}&s=price-asc-rank"
    headers = {**HEADERS, "Accept-Language": "en-US,en;q=0.9"}

    try:
        res = requests.get(url, headers=headers, timeout=15)
        prices_usd = []
        patterns = [
            r'"price":\{"amount":"([\d.]+)"',
            r'<span class="a-price-whole">([\d,]+)',
            r'"priceAmount":([\d.]+)',
        ]
        for pattern in patterns:
            found = re.findall(pattern, res.text)
            for p in found:
                try:
                    val = float(p.replace(",", ""))
                    if 0.5 < val < 200:
                        prices_usd.append(val)
                except:
                    pass

        if prices_usd:
            usd = min(prices_usd)
            krw = int(usd * usd_rate)
            return validate_price(krw, weight_oz)
    except Exception as e:
        print(f"    아마존 실패: {e}")
    return None

# ─── 이베이 ───────────────────────────────────────────
def crawl_ebay(weight_oz, usd_rate):
    g = OZ_TO_G[weight_oz]
    query = f"tungsten fishing sinker {weight_oz}oz {g}g"
    url = "https://www.ebay.com/sch/i.html"
    params = {"_nkw": query, "_sop": "15"}
    headers = {**HEADERS, "Accept-Language": "en-US,en;q=0.9"}

    try:
        res = requests.get(url, params=params, headers=headers, timeout=15)
        prices_usd = []
        patterns = [
            r'"price":\{"value":([\d.]+)',
            r'\$\s*([\d]+\.[\d]{2})',
        ]
        for pattern in patterns:
            found = re.findall(pattern, res.text)
            for p in found:
                try:
                    val = float(p.replace(",", ""))
                    if 0.5 < val < 200:
                        prices_usd.append(val)
                except:
                    pass

        if prices_usd:
            usd = min(prices_usd)
            krw = int(usd * usd_rate)
            return validate_price(krw, weight_oz)
    except Exception as e:
        print(f"    이베이 실패: {e}")
    return None

# ─── Sheets 저장 ──────────────────────────────────────
def save_to_sheets(book, results, usd_rate):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    try:
        sheet_latest = book.worksheet("최신가격")
    except:
        sheet_latest = book.add_worksheet("최신가격", rows=100, cols=20)

    sheet_latest.clear()
    sheet_latest.append_row(["무게(oz)", "무게(g)", "네이버", "알리", "아마존", "이베이", "환율(USD/KRW)", "마지막업데이트"])
    for weight, prices in results.items():
        row = [
            weight, OZ_TO_G.get(weight, ""),
            prices.get("naver", ""), prices.get("ali", ""),
            prices.get("amazon", ""), prices.get("ebay", ""),
            int(usd_rate), now,
        ]
        sheet_latest.append_row(row)
        time.sleep(0.3)

    try:
        sheet_history = book.worksheet("히스토리")
    except:
        sheet_history = book.add_worksheet("히스토리", rows=10000, cols=20)
        sheet_history.append_row(["날짜", "무게(oz)", "네이버", "알리", "아마존", "이베이", "환율"])

    for weight, prices in results.items():
        row = [
            now, weight,
            prices.get("naver", ""), prices.get("ali", ""),
            prices.get("amazon", ""), prices.get("ebay", ""),
            int(usd_rate),
        ]
        sheet_history.append_row(row)
        time.sleep(0.3)

    print(f"✅ Sheets 저장 완료: {now}")

# ─── 메인 ─────────────────────────────────────────────
def main():
    print("🎣 텅스텐 싱커 가격 수집 시작...")

    # 실시간 환율 가져오기
    usd_rate = get_usd_to_krw()
    results = {}

    for weight in WEIGHTS:
        print(f"\n📦 {weight}oz ({OZ_TO_G[weight]}g) 수집 중...")
        prices = {}

        naver = crawl_naver(weight, usd_rate)
        prices["naver"] = naver
        print(f"  네이버: {naver:,}원" if naver else "  네이버: 실패")
        time.sleep(1)

        ali = crawl_ali(weight, usd_rate)
        prices["ali"] = ali
        print(f"  알리: {ali:,}원" if ali else "  알리: 실패")
        time.sleep(1)

        amazon = crawl_amazon(weight, usd_rate)
        prices["amazon"] = amazon
        print(f"  아마존: {amazon:,}원" if amazon else "  아마존: 실패")
        time.sleep(2)

        ebay = crawl_ebay(weight, usd_rate)
        prices["ebay"] = ebay
        print(f"  이베이: {ebay:,}원" if ebay else "  이베이: 실패")
        time.sleep(2)

        results[weight] = prices

        # 가격 무결성 체크 출력
        valid_prices = [v for v in prices.values() if v]
        if valid_prices:
            print(f"  ✓ 유효 가격: {len(valid_prices)}개, 범위: {min(valid_prices):,}~{max(valid_prices):,}원")

    book = connect_sheets()
    save_to_sheets(book, results, usd_rate)
    print("\n🏁 완료!")

if __name__ == "__main__":
    main()
