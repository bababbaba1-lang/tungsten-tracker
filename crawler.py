"""
텅스텐 싱커 가격 크롤러
- 네이버쇼핑, 알리익스프레스, 아마존, 이베이, 테무 가격 수집
- Google Sheets에 자동 저장
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

# 환율 (USD → KRW)
USD_TO_KRW = 1380

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}

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
def crawl_naver(weight_oz):
    g = OZ_TO_G[weight_oz]
    query = f"텅스텐 싱커 {g}g"
    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    }
    params = {"query": query, "display": 5, "sort": "asc"}
    try:
        res = requests.get(url, headers=headers, params=params, timeout=10)
        data = res.json()
        items = data.get("items", [])
        if not items:
            return None
        prices = []
        for item in items:
            price_str = re.sub(r"<[^>]+>", "", str(item.get("lprice", 0)))
            try:
                prices.append(int(price_str))
            except:
                pass
        return min(prices) if prices else None
    except Exception as e:
        print(f"  [네이버] 오류: {e}")
        return None

# ─── 알리익스프레스 ────────────────────────────────────
def crawl_ali(weight_oz):
    g = OZ_TO_G[weight_oz]
    query = f"tungsten fishing sinker {g}g"
    url = "https://www.aliexpress.com/wholesale"
    params = {"SearchText": query, "SortType": "price_asc"}
    try:
        res = requests.get(url, params=params, headers=HEADERS, timeout=15)
        prices = re.findall(r'"salePrice":\{"currency":"USD","value":"([\d.]+)"', res.text)
        if not prices:
            prices = re.findall(r'US \$([\d.]+)', res.text)
        if prices:
            usd = float(min(prices, key=float))
            return int(usd * USD_TO_KRW)
        return None
    except Exception as e:
        print(f"  [알리] 오류: {e}")
        return None

# ─── 아마존 ───────────────────────────────────────────
def crawl_amazon(weight_oz):
    g = OZ_TO_G[weight_oz]
    oz = weight_oz.replace("/", "%2F")
    query = f"tungsten+fishing+sinker+{oz}oz"
    url = f"https://www.amazon.com/s?k={query}&s=price-asc-rank"
    headers = {**HEADERS, "Accept-Language": "en-US,en;q=0.9"}
    try:
        res = requests.get(url, headers=headers, timeout=15)
        # 가격 패턴 여러 가지 시도
        patterns = [
            r'"price":\{"amount":"([\d.]+)"',
            r'<span class="a-price-whole">([\d,]+)',
            r'"priceAmount":([\d.]+)',
            r'data-a-price.*?"([\d.]+)"',
        ]
        prices = []
        for pattern in patterns:
            found = re.findall(pattern, res.text)
            for p in found:
                try:
                    prices.append(float(p.replace(",", "")))
                except:
                    pass
        if prices:
            usd = min(p for p in prices if p > 0.5)  # 0.5달러 미만은 노이즈 제거
            return int(usd * USD_TO_KRW)
        return None
    except Exception as e:
        print(f"  [아마존] 오류: {e}")
        return None

# ─── 이베이 ───────────────────────────────────────────
def crawl_ebay(weight_oz):
    g = OZ_TO_G[weight_oz]
    query = f"tungsten fishing sinker {weight_oz}oz {g}g"
    url = "https://www.ebay.com/sch/i.html"
    params = {"_nkw": query, "_sop": "15"}  # 15 = 가격 낮은 순
    headers = {**HEADERS, "Accept-Language": "en-US,en;q=0.9"}
    try:
        res = requests.get(url, params=params, headers=headers, timeout=15)
        # 이베이 가격 패턴
        patterns = [
            r'"price":\{"value":([\d.]+)',
            r'class="s-item__price"[^>]*>\$?([\d.]+)',
            r'\$\s*([\d]+\.[\d]{2})',
        ]
        prices = []
        for pattern in patterns:
            found = re.findall(pattern, res.text)
            for p in found:
                try:
                    val = float(p.replace(",", ""))
                    if 0.5 < val < 500:  # 합리적인 범위만
                        prices.append(val)
                except:
                    pass
        if prices:
            usd = min(prices)
            return int(usd * USD_TO_KRW)
        return None
    except Exception as e:
        print(f"  [이베이] 오류: {e}")
        return None

# ─── 테무 ─────────────────────────────────────────────
def crawl_temu(weight_oz):
    g = OZ_TO_G[weight_oz]
    query = f"tungsten sinker {g}g fishing"
    url = "https://www.temu.com/search_result.html"
    params = {"search_key": query}
    try:
        res = requests.get(url, params=params, headers=HEADERS, timeout=15)
        patterns = [
            r'"price":([\d.]+)',
            r'"sale_price":([\d.]+)',
            r'"display_price":"\\$([\d.]+)"',
        ]
        prices = []
        for pattern in patterns:
            found = re.findall(pattern, res.text)
            for p in found:
                try:
                    val = float(p)
                    if 0.5 < val < 100:
                        prices.append(val)
                except:
                    pass
        if prices:
            usd = min(prices)
            return int(usd * USD_TO_KRW)
        return None
    except Exception as e:
        print(f"  [테무] 오류: {e}")
        return None

# ─── Sheets 저장 ──────────────────────────────────────
def save_to_sheets(book, results):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    # 최신가격 시트
    try:
        sheet_latest = book.worksheet("최신가격")
    except:
        sheet_latest = book.add_worksheet("최신가격", rows=100, cols=20)

    sheet_latest.clear()
    sheet_latest.append_row(["무게(oz)", "무게(g)", "네이버", "알리", "아마존", "이베이", "테무", "마지막업데이트"])
    for weight, prices in results.items():
        row = [
            weight, OZ_TO_G.get(weight, ""),
            prices.get("naver", ""), prices.get("ali", ""),
            prices.get("amazon", ""), prices.get("ebay", ""),
            prices.get("temu", ""), now,
        ]
        sheet_latest.append_row(row)
        time.sleep(0.3)

    # 히스토리 시트
    try:
        sheet_history = book.worksheet("히스토리")
    except:
        sheet_history = book.add_worksheet("히스토리", rows=10000, cols=20)
        sheet_history.append_row(["날짜", "무게(oz)", "네이버", "알리", "아마존", "이베이", "테무"])

    for weight, prices in results.items():
        row = [
            now, weight,
            prices.get("naver", ""), prices.get("ali", ""),
            prices.get("amazon", ""), prices.get("ebay", ""),
            prices.get("temu", ""),
        ]
        sheet_history.append_row(row)
        time.sleep(0.3)

    print(f"✅ Sheets 저장 완료: {now}")

# ─── 메인 ─────────────────────────────────────────────
def main():
    print("🎣 텅스텐 싱커 가격 수집 시작...")
    results = {}

    for weight in WEIGHTS:
        print(f"\n📦 {weight}oz 수집 중...")
        prices = {}

        naver = crawl_naver(weight)
        prices["naver"] = naver
        print(f"  네이버: {naver:,}원" if naver else "  네이버: 실패")
        time.sleep(1)

        ali = crawl_ali(weight)
        prices["ali"] = ali
        print(f"  알리: {ali:,}원" if ali else "  알리: 실패")
        time.sleep(1)

        amazon = crawl_amazon(weight)
        prices["amazon"] = amazon
        print(f"  아마존: {amazon:,}원" if amazon else "  아마존: 실패")
        time.sleep(2)

        ebay = crawl_ebay(weight)
        prices["ebay"] = ebay
        print(f"  이베이: {ebay:,}원" if ebay else "  이베이: 실패")
        time.sleep(2)

        temu = crawl_temu(weight)
        prices["temu"] = temu
        print(f"  테무: {temu:,}원" if temu else "  테무: 실패")
        time.sleep(1)

        results[weight] = prices

    book = connect_sheets()
    save_to_sheets(book, results)
    print("\n🏁 완료!")

if __name__ == "__main__":
    main()
