#!/usr/bin/env python3
"""
Supabase 중복 데이터 정리 스크립트
- 각 key별로 updated_at이 가장 최신인 row만 남기고 나머지 삭제
- 매일 자동 실행 권장 (cron 설정)
"""
import os
from supabase import create_client

# Supabase 설정
SUPABASE_URL = 'https://vihrydqudawrlwddffwa.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHJ5ZHF1ZGF3cmx3ZGRmZndhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTcxNjIsImV4cCI6MjA5MTgzMzE2Mn0.5QkOjtl25PgbCDenWNgyqelbgPeerg6sqROQa624G9A'
SUPABASE_TABLE = 'studio_data'

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def cleanup_duplicates():
    """각 key별로 최신 row만 남기고 중복 삭제"""
    print("🔍 중복 데이터 검사 시작...")

    # 모든 row 가져오기 (테이블 구조 확인)
    result = supabase.table(SUPABASE_TABLE).select('*').execute()
    rows = result.data

    if not rows:
        print("✅ 데이터 없음")
        return

    print(f"📊 총 {len(rows)}개 row 발견")

    # 첫 번째 row 구조 확인 (디버깅)
    if rows:
        print(f"📋 테이블 컬럼: {list(rows[0].keys())}")

    # key별로 그룹화
    by_key = {}
    for row in rows:
        key = row['key']
        if key not in by_key:
            by_key[key] = []
        by_key[key].append(row)

    print(f"🔑 고유 key 개수: {len(by_key)}")
    for key, group in by_key.items():
        print(f"  - {key}: {len(group)}개")

    # 삭제할 row 찾기
    to_delete = []
    total_duplicates = 0

    for key, group in by_key.items():
        if len(group) > 1:
            # updated_at 기준으로 정렬 (최신이 먼저)
            sorted_group = sorted(group, key=lambda r: r['updated_at'], reverse=True)
            # 첫 번째(최신)를 제외한 나머지는 삭제 대상
            duplicates = sorted_group[1:]
            to_delete.extend([r['id'] for r in duplicates])
            total_duplicates += len(duplicates)
            print(f"  - {key}: {len(group)}개 중복 발견 → {len(duplicates)}개 삭제 예정")

    if not to_delete:
        print("✅ 중복 없음. 정리할 데이터 없음")
        return

    # 삭제 실행
    print(f"\n🗑️  총 {total_duplicates}개 중복 row 삭제 중...")
    for row_id in to_delete:
        supabase.table(SUPABASE_TABLE).delete().eq('id', row_id).execute()

    print(f"✅ 정리 완료! {total_duplicates}개 삭제됨")

if __name__ == '__main__':
    try:
        cleanup_duplicates()
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        exit(1)
