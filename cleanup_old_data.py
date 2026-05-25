#!/usr/bin/env python3
"""
기존 체크포인트 및 레거시 백업 정리 스크립트
- checkpoint_* 전체 삭제
- backup_YYYYMMDD (레거시 일간 백업) 전체 삭제
- backup_manual (단일 수동 백업) 삭제
- backup_before_restore_* 전체 삭제
"""
from supabase import create_client

SUPABASE_URL = 'https://vihrydqudawrlwddffwa.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHJ5ZHF1ZGF3cmx3ZGRmZndhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTcxNjIsImV4cCI6MjA5MTgzMzE2Mn0.5QkOjtl25PgbCDenWNgyqelbgPeerg6sqROQa624G9A'
SUPABASE_TABLE = 'studio_data'

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 전체 키 조회
result = supabase.table(SUPABASE_TABLE).select('key').execute()
all_keys = [r['key'] for r in result.data]

# 삭제 대상 분류
to_delete = []
for key in all_keys:
    if key.startswith('checkpoint_'):
        to_delete.append(key)
    elif key.startswith('backup_before_restore_'):
        to_delete.append(key)
    elif key == 'backup_manual':
        to_delete.append(key)
    elif key.startswith('backup_') and not key.startswith('backup_auto_') and not key.startswith('backup_manual_'):
        # 레거시 일간 백업 (backup_YYYYMMDD)
        to_delete.append(key)

print(f"=== 정리 대상: {len(to_delete)}개 ===\n")
for key in sorted(to_delete):
    print(f"  - {key}")

if not to_delete:
    print("\n정리할 데이터가 없습니다.")
    exit(0)

confirm = input(f"\n{len(to_delete)}개 삭제하시겠습니까? (y/n): ")
if confirm.lower() != 'y':
    print("취소됨")
    exit(0)

# 삭제 실행
deleted = 0
for key in to_delete:
    try:
        supabase.table(SUPABASE_TABLE).delete().eq('key', key).execute()
        deleted += 1
        print(f"✓ 삭제: {key}")
    except Exception as e:
        print(f"✗ 실패: {key} - {e}")

print(f"\n=== 완료: {deleted}개 삭제됨 ===")
