"""
텅스텐 싱커 가격 크롤러 v5
- 네이버 쇼핑 API 전용
- 무게별 상위 쇼핑몰 + 가격 + 상품링크 수집
"""

import os
import re
import time
import requests
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from datetime import datetime

SPREADSHEET_ID = "1jWL31J8bqKLE9OC0CW7Q8Ac6HpzpLE2L_q5L5SNGmAA"
NAVER_CLIENT_ID = os.environ.get("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET")

WEIGHTS = ["1/8", "1/4", "3/8", "1/2", "3/4", "1"]
OZ_TO_G = {
    "1/8": 3.5, "1/4": 7.1, "3/8": 10.6,
    "1/2": 14.2, "3/4": 21.3, "1": 28.4
}
TOP_N = 5  # 무게별 상위 몇 개 쇼핑몰 저장

def parse_weight_from_title(title):
    title_lower = title.lower()
    oz_patterns = [r'(\d+/\d+)\s*oz', r'(\d+/\d+)\s*온스', r'(\d+/\d+)\s*ounce']
    for pattern in oz_patterns:
        m = re.search(pattern, title_lower)
        if m and m.group(1) in WEIGHTS:
            return m.group(1)
    g_patterns = [r'(\d+\.?\d*)\s*g[^a-z]', r'(\d+\.?\d*)g\b', r'(\d+\.?\d*)\s*그램']
    for pattern in g_patterns:
        m = re.search(pattern, title_lower)
        if m:
            g_val = float(m.group(1))
            for oz, g in OZ_TO_G.items():
                if abs(g_val - g) <= 1.5:
                    return oz
    return None

def connect_sheets():
    scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write(creds_json)
            creds_file = f.name
        creds = ServiceAccountCredentials.from_json_keyfile_name(creds_file, scope)
    else:
        creds = ServiceAccountCredentials.from_json_keyfile_name("credentials.json", scope)
    return gspread.authorize(creds).open_by_key(SPREADSHEET_ID)

def crawl_naver():
    """네이버 쇼핑에서 텅스텐 싱커 수집 → 무게별 상위 쇼핑몰 리스트 반환"""
    url = "https://openapi.naver.com/v1/search/shop.json"
    headers = {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    }

    # 무게별 상품 딕셔너리 {oz: [{price, title, link, mall, image}]}
    weight_items = {oz: [] for oz in WEIGHTS}

    queries = ["텅스텐 싱커", "tungsten sinker", "텅스텐 낚시 봉돌 oz"]

    for query in queries:
        for start in range(1, 100, 10):
            try:
                params = {"query": query, "display": 10, "start": start, "sort": "sim"}
                res = requests.get(url, headers=headers, params=params, timeout=10)
                data = res.json()
                items = data.get("items", [])
                if not items:
                    break

                for item in items:
                    title = re.sub(r"<[^>]+>", "", item.get("title", ""))
                    title_lower = title.lower()

                    # 텅스텐+싱커 관련 상품만
                    if not any(k in title_lower for k in ["텅스텐", "tungsten"]):
                        continue
                    if not any(k in title_lower for k in ["싱커", "sinker", "봉돌"]):
                        continue

                    try:
                        price = int(item.get("lprice", 0))
                    except:
                        continue
                    if price <= 0:
                        continue

                    oz = parse_weight_from_title(title)
                    if not oz:
                        continue

                    weight_items[oz].append({
                        "price": price,
                        "title": title,
                        "link": item.get("link", ""),
                        "mall": item.get("mallName", "네이버쇼핑"),
                        "image": item.get("image", ""),
                    })

                time.sleep(0.3)
            except Exception as e:
                print(f"  오류 (query={query}, start={start}): {e}")
                break
        time.sleep(0.5)

    # 무게별 정렬 & 중복 제거 & 상위 N개
    results = {}
    for oz in WEIGHTS:
        items = weight_items[oz]
        if not items:
            results[oz] = []
            continue

        # 가격 오름차순 정렬
        items.sort(key=lambda x: x["price"])

        # 중앙값 기반 노이즈 제거
        prices = [i["price"] for i in items]
        if len(prices) >= 3:
            median = sorted(prices)[len(prices) // 2]
            items = [i for i in items if i["price"] >= median * 0.2]

        # 쇼핑몰 중복 제거 (같은 몰은 최저가 1개만)
        seen_malls = {}
        for item in items:
            mall = item["mall"]
            if mall not in seen_malls:
                seen_malls[mall] = item

        unique_items = sorted(seen_malls.values(), key=lambda x: x["price"])
        results[oz] = unique_items[:TOP_N]

        print(f"  {oz}oz ({OZ_TO_G[oz]}g): {len(unique_items)}개 쇼핑몰")
        for i, item in enumerate(results[oz], 1):
            print(f"    #{i} {item['mall']} — {item['price']:,}원")

    return results

def save_to_sheets(book, results):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    # 최신가격 시트 (무게별 상위 쇼핑몰 목록)
    try:
        sheet = book.worksheet("최신가격")
    except:
        sheet = book.add_worksheet("최신가격", rows=500, cols=10)

    sheet.clear()
    sheet.append_row(["무게(oz)", "무게(g)", "순위", "쇼핑몰", "가격", "상품명", "링크", "업데이트"])

    for oz in WEIGHTS:
        items = results.get(oz, [])
        if not items:
            sheet.append_row([oz, OZ_TO_G[oz], "-", "없음", "", "", "", now])
            time.sleep(0.2)
            continue
        for rank, item in enumerate(items, 1):
            sheet.append_row([
                oz,
                OZ_TO_G[oz],
                rank,
                item["mall"],
                item["price"],
                item["title"][:80],
                item["link"],
                now,
            ])
            time.sleep(0.2)

    # 히스토리 시트 (무게별 1위 가격만 기록)
    try:
        sheet_h = book.worksheet("히스토리")
    except:
        sheet_h = book.add_worksheet("히스토리", rows=10000, cols=10)
        sheet_h.append_row(["날짜", "무게(oz)", "1위쇼핑몰", "1위가격"])

    for oz in WEIGHTS:
        items = results.get(oz, [])
        if items:
            sheet_h.append_row([now, oz, items[0]["mall"], items[0]["price"]])
        else:
            sheet_h.append_row([now, oz, "", ""])
        time.sleep(0.2)

    print(f"\n✅ Sheets 저장 완료: {now}")

def main():
    print("🎣 텅스텐 싱커 가격 수집 시작 (v5 - 네이버 전용)...\n")
    print("[네이버 수집 중...]")
    results = crawl_naver()
    book = connect_sheets()
    save_to_sheets(book, results)
    print("\n🏁 완료!")

if __name__ == "__main__":
    main()
